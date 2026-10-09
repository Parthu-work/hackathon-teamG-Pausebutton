import { and, eq, inArray } from "drizzle-orm";
import webpush, { WebPushError } from "web-push";
import { z } from "zod";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { errorFields, log } from "./log";

// Web Push: phones get a system notification (with vibration) even when the
// app is closed. Needs VAPID keys in the environment (`pnpm push:keys`);
// without them everything else works and this module just does nothing.
//
// Every delivery is written to push_deliveries (sent / failed with the error /
// gone), so a missing notification can be traced. A temporary failure from the
// push service (429, 5xx, network) is retried once; a phone that unsubscribed
// (404, 410) is forgotten; a person who turned Notifications off is skipped.

export type PushKind = "urgent" | "headsup" | "ask" | "message" | "outcome" | "test";

export type PushPayload = {
  title: string;
  body: string;
  /** Where a tap lands. Family alerts use /open/<alertId>, which resolves to the right screen. */
  url: string;
  /** One notification per tag on a phone: a repeat replaces the earlier one. */
  tag: string;
  urgent: boolean;
  kind?: PushKind;
  /** The family alert this is about. */
  alertId?: string | null;
  /** The check behind it: a newer notification about the same check replaces an older one in the tray. */
  checkId?: string | null;
  /** F2: a paused payment the notification's buttons can block without opening the app. */
  holdId?: string | null;
  actions?: { action: "block" | "fine"; title: string }[];
  /** "Papa": for the follow-up notification after a lock-screen Block. */
  who?: string;
  /** When it happened (ISO), so the tray shows the right time. */
  at?: string;
};

export type PushOptions = {
  /** Idempotency key ("alert:<id>"): a phone that already got it is not sent it again. */
  key?: string | null;
  alertId?: string | null;
  checkId?: string | null;
  /** Send even if the person turned Notifications off (their own test alert). */
  force?: boolean;
  /** Pause before the one retry of a temporary failure. */
  retryDelayMs?: number;
};

export type PushResult = { sent: number; failed: number; gone: number; skipped: number };
const NONE: PushResult = { sent: 0, failed: 0, gone: 0, skipped: 0 };

export const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
export type SubscriptionInput = z.infer<typeof subscriptionSchema>;

export function pushEnabled() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function pushPublicKey() {
  return pushEnabled() ? process.env.VAPID_PUBLIC_KEY! : null;
}

let configured = false;
function configure() {
  if (configured) return true;
  if (!pushEnabled()) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:pause-button@example.com",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
  return true;
}

/**
 * Registers (or re-registers) one phone for a person. The endpoint is the
 * key: a phone that a different person signs in on moves to them. When the
 * phone's push service replaced its endpoint, `previousEndpoint` is forgotten.
 */
export async function saveSubscription(db: Db, userId: string, sub: SubscriptionInput, userAgent?: string | null, previousEndpoint?: string | null) {
  if (previousEndpoint && previousEndpoint !== sub.endpoint) {
    await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, previousEndpoint));
  }
  const row = { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent ?? null };
  await db
    .insert(schema.pushSubscriptions)
    .values(row)
    .onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: row });
}

/** Sign-out or "Notifications off": this phone no longer gets this person's alerts. */
export async function removeSubscription(db: Db, userId: string, endpoint: string) {
  await db
    .delete(schema.pushSubscriptions)
    .where(and(eq(schema.pushSubscriptions.userId, userId), eq(schema.pushSubscriptions.endpoint, endpoint)));
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 750;
const MAX_RETRY_AFTER_MS = 5_000;

type Outcome = { status: "sent" | "failed" | "gone"; statusCode: number | null; error: string | null; attempts: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The push service's Retry-After (seconds), when it is short enough to wait for. */
function retryAfterMs(error: unknown): number | null {
  if (!(error instanceof WebPushError)) return null;
  const header = (error.headers as Record<string, string | undefined> | undefined)?.["retry-after"];
  const seconds = header ? Number(header) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : null;
}

async function deliver(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  body: string,
  options: { TTL: number; urgency: "high" | "normal" },
  retryDelayMs: number,
): Promise<Outcome> {
  let last: Outcome = { status: "failed", statusCode: null, error: "not attempted", attempts: 0 };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await webpush.sendNotification(subscription, body, options);
      return { status: "sent", statusCode: res?.statusCode ?? null, error: null, attempts: attempt };
    } catch (error) {
      const code = error instanceof WebPushError ? error.statusCode : null;
      const message = error instanceof Error ? error.message : String(error);
      if (code === 404 || code === 410) return { status: "gone", statusCode: code, error: message, attempts: attempt };
      last = { status: "failed", statusCode: code, error: message, attempts: attempt };
      // Only a temporary problem (the service is busy, the network blinked) is worth one more try.
      const temporary = code === null || RETRY_STATUSES.has(code);
      if (!temporary || attempt === MAX_ATTEMPTS) break;
      await sleep(retryAfterMs(error) ?? retryDelayMs);
    }
  }
  return last;
}

/**
 * Sends one notification to every phone of each person who wants them.
 * Never throws: an alert must not fail because a push did. Returns how many
 * phones got it, how many failed, how many were forgotten (unsubscribed) and
 * how many were skipped because they already had this key.
 */
export async function pushToUsers(db: Db, userIds: string[], payload: PushPayload, opts: PushOptions = {}): Promise<PushResult> {
  if (!userIds.length || !configure()) return NONE;
  try {
    let recipients = [...new Set(userIds)];
    if (!opts.force) {
      const users = await db.query.users.findMany({ where: inArray(schema.users.id, recipients) });
      recipients = users.filter((u) => u.alertNotify).map((u) => u.id);
    }
    if (!recipients.length) return NONE;

    let rows = await db.query.pushSubscriptions.findMany({ where: inArray(schema.pushSubscriptions.userId, recipients) });
    if (!rows.length) return NONE;

    // Idempotent: a phone that already has this alert is not told twice.
    let skipped = 0;
    if (opts.key) {
      const done = await db.query.pushDeliveries.findMany({
        where: and(
          eq(schema.pushDeliveries.key, opts.key),
          eq(schema.pushDeliveries.status, "sent"),
          inArray(schema.pushDeliveries.endpoint, rows.map((r) => r.endpoint)),
        ),
      });
      const had = new Set(done.map((d) => d.endpoint));
      skipped = rows.filter((r) => had.has(r.endpoint)).length;
      rows = rows.filter((r) => !had.has(r.endpoint));
      if (!rows.length) return { ...NONE, skipped };
    }

    const body = JSON.stringify(payload);
    const options = { TTL: payload.urgent ? 300 : 3600, urgency: payload.urgent ? ("high" as const) : ("normal" as const) };
    const outcomes = await Promise.all(
      rows.map((r) => deliver({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, body, options, opts.retryDelayMs ?? RETRY_DELAY_MS)),
    );

    await db.insert(schema.pushDeliveries).values(
      rows.map((r, i) => ({
        userId: r.userId,
        alertId: opts.alertId ?? null,
        checkId: opts.checkId ?? null,
        key: opts.key ?? null,
        tag: payload.tag,
        endpoint: r.endpoint,
        status: outcomes[i].status,
        statusCode: outcomes[i].statusCode,
        error: outcomes[i].error,
        attempts: outcomes[i].attempts,
      })),
    );

    const gone = rows.filter((_, i) => outcomes[i].status === "gone").map((r) => r.id);
    const alive = rows.filter((_, i) => outcomes[i].status === "sent").map((r) => r.id);
    const failed = outcomes.filter((o) => o.status === "failed");
    for (const f of failed) log.warn("push_failed", { statusCode: f.statusCode ?? "network", attempts: f.attempts, error: f.error });
    if (gone.length) await db.delete(schema.pushSubscriptions).where(inArray(schema.pushSubscriptions.id, gone));
    if (alive.length) await db.update(schema.pushSubscriptions).set({ lastUsedAt: new Date() }).where(inArray(schema.pushSubscriptions.id, alive));
    return { sent: alive.length, failed: failed.length, gone: gone.length, skipped };
  } catch (error) {
    log.warn("push_error", errorFields(error));
    return NONE;
  }
}

/** "3 phones · last alert reached this phone at …": what the settings screens can show. */
export async function pushStatusFor(db: Db, userId: string) {
  const subs = await db.query.pushSubscriptions.findMany({ where: eq(schema.pushSubscriptions.userId, userId) });
  const last = subs.map((s) => s.lastUsedAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
  return { phones: subs.length, lastSentAt: last ? new Date(last).toISOString() : null };
}
