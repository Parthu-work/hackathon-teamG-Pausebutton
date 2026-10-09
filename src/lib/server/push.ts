import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import webpush, { WebPushError } from "web-push";
import { z } from "zod";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { APP_UTC_OFFSET_MINUTES } from "@/lib/check/config";
import { errorFields, log } from "./log";

// Web Push: phones get a system notification (with vibration) even when the
// app is closed. Needs VAPID keys in the environment (`pnpm push:keys`);
// without them everything else works and this module just does nothing.
//
// Every delivery is written to push_deliveries (sent / failed with the error /
// gone), so a missing notification can be traced. A temporary failure from the
// push service (429, 5xx, network) is retried once; a phone that unsubscribed
// (404, 410) is forgotten; a person who turned Notifications off is skipped.
//
// Receipts: each phone's copy carries its delivery row's id, and the service
// worker reports back once the notification is on screen (or why it could
// not be shown). A push the service accepted that no phone ever confirms is
// "silent": it is logged when that phone is next sent one, and counted in the
// operators' delivery health (/api/ops/push-health).

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
  /** This phone's delivery id: the service worker sends it back once the notification shows. */
  receipt?: string;
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

    await warnAboutSilentPhones(db, rows.map((r) => r.endpoint));

    // Each phone's copy carries its own delivery id, for the receipt.
    const ids = rows.map(() => crypto.randomUUID());
    const options = { TTL: payload.urgent ? 300 : 3600, urgency: payload.urgent ? ("high" as const) : ("normal" as const) };
    const outcomes = await Promise.all(
      rows.map((r, i) =>
        deliver(
          { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
          JSON.stringify({ ...payload, receipt: ids[i] }),
          options,
          opts.retryDelayMs ?? RETRY_DELAY_MS,
        ),
      ),
    );

    await db.insert(schema.pushDeliveries).values(
      rows.map((r, i) => ({
        id: ids[i],
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

/** A push still unconfirmed this long after the service accepted it counts as silent. */
export const SILENT_AFTER_MS = 2 * 60_000;
/** This many silent pushes in a row (last 24 hours) and the phone is reported. */
const SILENT_STREAK = 2;

/**
 * The service worker's report: the push arrived, and the notification is on
 * screen (or could not be shown, and why). The delivery id is the only
 * credential: it is random and only that phone was sent it. Only the first
 * receipt counts, and an unknown id changes nothing.
 */
export async function recordReceipt(db: Db, deliveryId: string, shown: boolean, displayError?: string | null) {
  const now = new Date();
  await db
    .update(schema.pushDeliveries)
    .set({ receivedAt: now, shownAt: shown ? now : null, displayError: shown ? null : (displayError ?? "not shown") })
    .where(and(eq(schema.pushDeliveries.id, deliveryId), eq(schema.pushDeliveries.status, "sent"), isNull(schema.pushDeliveries.receivedAt)));
}

/**
 * Phones whose last pushes were accepted by the push service but never
 * confirmed: the subscription looks valid, yet nothing shows (battery saver
 * killed the browser, the phone has been off, the OS blocks it). Logged, not
 * dropped: the next push may still get through.
 */
async function warnAboutSilentPhones(db: Db, endpoints: string[], now = Date.now()) {
  const recent = await db.query.pushDeliveries.findMany({
    where: and(
      inArray(schema.pushDeliveries.endpoint, endpoints),
      eq(schema.pushDeliveries.status, "sent"),
      gte(schema.pushDeliveries.createdAt, new Date(now - 24 * 60 * 60_000)),
      lt(schema.pushDeliveries.createdAt, new Date(now - SILENT_AFTER_MS)),
    ),
    orderBy: (d, { desc }) => desc(d.createdAt),
  });
  for (const endpoint of endpoints) {
    const latest = recent.filter((d) => d.endpoint === endpoint).slice(0, SILENT_STREAK);
    if (latest.length === SILENT_STREAK && latest.every((d) => !d.receivedAt)) {
      log.warn("push_silent_phone", { userId: latest[0].userId, unconfirmed: SILENT_STREAK, pushService: new URL(endpoint).host });
    }
  }
}

export type PushHealthDay = { day: string; sent: number; failed: number; gone: number; received: number; shown: number; notShown: number; silent: number };

/**
 * Delivery health for operators: per day (India time), how many pushes the
 * push services accepted, refused or reported gone, and of the accepted ones
 * how many phones confirmed, showed, could not show, or never answered.
 */
export async function pushHealth(db: Db, days = 14, now = new Date()) {
  const since = new Date(now.getTime() - days * 24 * 60 * 60_000);
  const silentBefore = new Date(now.getTime() - SILENT_AFTER_MS);
  const d = schema.pushDeliveries;
  const day = sql<string>`to_char((${d.createdAt} at time zone 'UTC') + make_interval(mins => ${APP_UTC_OFFSET_MINUTES}), 'YYYY-MM-DD')`;
  const rows = await db
    .select({
      day,
      sent: sql<number>`count(*) filter (where ${d.status} = 'sent')`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${d.status} = 'failed')`.mapWith(Number),
      gone: sql<number>`count(*) filter (where ${d.status} = 'gone')`.mapWith(Number),
      received: sql<number>`count(${d.receivedAt})`.mapWith(Number),
      shown: sql<number>`count(${d.shownAt})`.mapWith(Number),
      notShown: sql<number>`count(*) filter (where ${d.receivedAt} is not null and ${d.shownAt} is null)`.mapWith(Number),
      silent: sql<number>`count(*) filter (where ${d.status} = 'sent' and ${d.receivedAt} is null and ${d.createdAt} < ${silentBefore.toISOString()}::timestamptz)`.mapWith(Number),
    })
    .from(d)
    .where(gte(d.createdAt, since))
    .groupBy(sql`1`) // by position: the day expression carries its own parameter
    .orderBy(sql`1 desc`);
  const total = rows.reduce<Omit<PushHealthDay, "day">>(
    (t, r) => ({ sent: t.sent + r.sent, failed: t.failed + r.failed, gone: t.gone + r.gone, received: t.received + r.received, shown: t.shown + r.shown, notShown: t.notShown + r.notShown, silent: t.silent + r.silent }),
    { sent: 0, failed: 0, gone: 0, received: 0, shown: 0, notShown: 0, silent: 0 },
  );
  return { days: rows as PushHealthDay[], total, silentAfterMinutes: SILENT_AFTER_MS / 60_000, enabled: pushEnabled() };
}

/** "3 phones · last alert reached this phone at …": what the settings screens can show. */
export async function pushStatusFor(db: Db, userId: string) {
  const subs = await db.query.pushSubscriptions.findMany({ where: eq(schema.pushSubscriptions.userId, userId) });
  const last = subs.map((s) => s.lastUsedAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
  return { phones: subs.length, lastSentAt: last ? new Date(last).toISOString() : null };
}
