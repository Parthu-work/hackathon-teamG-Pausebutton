import { and, eq, inArray, lt, lte } from "drizzle-orm";
import webpush, { WebPushError } from "web-push";
import { z } from "zod";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { PushPayload, PushStatus } from "@/lib/db/schema";

// Web Push: a person's phones get a system notification (with vibration) even
// when the app is closed or the phone is locked. Needs VAPID keys in the
// environment (`pnpm push:keys`); without them everything else works and this
// module does nothing (the apps still alert by polling while they are open).
//
// Every notification is logged in push_notifications, one row per person:
//  - a dedupe key ("alert:<id>") makes sending idempotent: at most once per person;
//  - the person's "Notifications" setting (users.alert_notify) is respected;
//  - a transient failure (network, 429, 5xx) is retried a couple of times at
//    once, then again later from the household's polling (retryDuePushes);
//  - a phone the push service says is gone (404/410) is forgotten, and so is
//    one that keeps failing permanently (e.g. its keys no longer match).

export type { PushPayload, PushStatus };

export const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
export type SubscriptionInput = z.infer<typeof subscriptionSchema>;

/** Tunables (tests shorten the delays). */
export const pushConfig = {
  /** Waits before the in-call retries of a transient failure. */
  retryDelaysMs: [250, 1000],
  /** Per-request timeout towards the push service. */
  timeoutMs: 5000,
  /** Total attempts per notification, including the later retries. */
  maxAttempts: 4,
  /** Waits before the later retries (2nd, 3rd, … attempt). */
  laterRetryMs: [15_000, 60_000, 180_000],
  /** Give up on a notification that still has not gone out after this long: the alert is stale. */
  giveUpAfterMs: 30 * 60_000,
  /** Forget a phone after this many permanent failures in a row. */
  forgetAfterFailures: 3,
};

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
 * Registers this phone for a person. An endpoint belongs to one browser, so
 * when someone else signs in on the same phone it moves to them: alerts never
 * reach the previous person's lock screen.
 */
export async function saveSubscription(db: Db, userId: string, sub: SubscriptionInput, userAgent?: string | null) {
  const row = {
    userId,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    userAgent: userAgent ?? null,
    failureCount: 0,
    lastError: null,
    lastErrorAt: null,
  };
  await db.insert(schema.pushSubscriptions).values(row).onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: row });
}

/**
 * The browser replaced its subscription (service worker "pushsubscriptionchange").
 * The old endpoint identifies the phone; the new one keeps the same person.
 * Returns false when the old endpoint is unknown (nothing to move).
 */
export async function replaceSubscription(db: Db, oldEndpoint: string, sub: SubscriptionInput, userAgent?: string | null) {
  const old = await db.query.pushSubscriptions.findFirst({ where: eq(schema.pushSubscriptions.endpoint, oldEndpoint) });
  if (!old) return false;
  if (oldEndpoint !== sub.endpoint) await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, old.id));
  await saveSubscription(db, old.userId, sub, userAgent ?? old.userAgent);
  return true;
}

export async function removeSubscription(db: Db, userId: string, endpoint: string) {
  await db
    .delete(schema.pushSubscriptions)
    .where(and(eq(schema.pushSubscriptions.userId, userId), eq(schema.pushSubscriptions.endpoint, endpoint)));
}

export type PushResult = { userId: string; status: PushStatus | "duplicate"; delivered: number };

/**
 * Sends one notification to every phone of each person. Never throws: an alert
 * must not fail because a push did.
 *  - `dedupeKey`: the same key is sent at most once per person (idempotent);
 *  - `householdId`: whose polling retries it if the push service is down.
 */
export async function pushToUsers(
  db: Db,
  userIds: string[],
  payload: PushPayload,
  opts: { dedupeKey?: string; householdId?: string } = {},
): Promise<{ sent: number; results: PushResult[] }> {
  const ids = [...new Set(userIds)];
  if (!ids.length || !configure()) return { sent: 0, results: [] };
  try {
    const users = await db.query.users.findMany({ where: inArray(schema.users.id, ids) });
    const results: PushResult[] = [];
    for (const user of users) {
      const [row] = await db
        .insert(schema.pushNotifications)
        .values({ userId: user.id, householdId: opts.householdId ?? null, dedupeKey: opts.dedupeKey ?? null, payload })
        .onConflictDoNothing()
        .returning();
      if (!row) {
        results.push({ userId: user.id, status: "duplicate", delivered: 0 });
        continue;
      }
      if (!user.alertNotify) {
        await finish(db, row.id, { status: "disabled", attempts: 0, devices: 0, delivered: 0, lastError: "Notifications are turned off in settings" });
        results.push({ userId: user.id, status: "disabled", delivered: 0 });
        continue;
      }
      results.push(await attempt(db, row));
    }
    return { sent: results.reduce((n, r) => n + r.delivered, 0), results };
  } catch (error) {
    console.warn("[push] failed:", error instanceof Error ? error.message : error);
    return { sent: 0, results: [] };
  }
}

/**
 * Retries this household's notifications that failed for a passing reason.
 * Called from the household's own polling, so no background job is needed;
 * claiming a row is a conditional update, so two polls never send it twice.
 */
export async function retryDuePushes(db: Db, householdId: string) {
  if (!configure()) return;
  try {
    const now = new Date();
    await db
      .update(schema.pushNotifications)
      .set({ status: "failed", nextAttemptAt: null, updatedAt: now })
      .where(
        and(
          eq(schema.pushNotifications.householdId, householdId),
          eq(schema.pushNotifications.status, "retrying"),
          lt(schema.pushNotifications.createdAt, new Date(now.getTime() - pushConfig.giveUpAfterMs)),
        ),
      );
    const claimed = await db
      .update(schema.pushNotifications)
      .set({ status: "sending", updatedAt: now })
      .where(
        and(
          eq(schema.pushNotifications.householdId, householdId),
          eq(schema.pushNotifications.status, "retrying"),
          lte(schema.pushNotifications.nextAttemptAt, now),
        ),
      )
      .returning();
    for (const row of claimed) await attempt(db, row);
  } catch (error) {
    console.warn("[push] retry failed:", error instanceof Error ? error.message : error);
  }
}

type Outcome = { kind: "ok" } | { kind: "gone" } | { kind: "permanent" | "transient"; error: string; retryAfterMs?: number };
type NotificationRow = typeof schema.pushNotifications.$inferSelect;

/** One delivery attempt of a notification to all of its person's phones. */
async function attempt(db: Db, row: NotificationRow): Promise<PushResult> {
  const attempts = row.attempts + 1;
  const subs = await db.query.pushSubscriptions.findMany({ where: eq(schema.pushSubscriptions.userId, row.userId) });
  if (!subs.length) {
    await finish(db, row.id, { status: "no_device", attempts, devices: 0, delivered: 0, lastError: "No phone is registered for notifications" });
    return { userId: row.userId, status: "no_device", delivered: 0 };
  }

  const body = JSON.stringify({ ...row.payload, id: row.id });
  const outcomes = await Promise.all(subs.map((s) => sendWithRetry(s, body, row.payload.urgent)));

  const now = new Date();
  const ok = subs.filter((_, i) => outcomes[i].kind === "ok").map((s) => s.id);
  const gone = subs.filter((_, i) => outcomes[i].kind === "gone").map((s) => s.id);
  if (ok.length) await db.update(schema.pushSubscriptions).set({ lastUsedAt: now, failureCount: 0, lastError: null }).where(inArray(schema.pushSubscriptions.id, ok));
  if (gone.length) await db.delete(schema.pushSubscriptions).where(inArray(schema.pushSubscriptions.id, gone));
  for (const [i, s] of subs.entries()) {
    const o = outcomes[i];
    if (o.kind !== "permanent" && o.kind !== "transient") continue;
    const failures = s.failureCount + 1;
    if (o.kind === "permanent" && failures >= pushConfig.forgetAfterFailures) {
      await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, s.id));
    } else {
      await db.update(schema.pushSubscriptions).set({ failureCount: failures, lastError: o.error, lastErrorAt: now }).where(eq(schema.pushSubscriptions.id, s.id));
    }
  }

  const errors = outcomes.flatMap((o) => ("error" in o ? [o.error] : []));
  const transient = outcomes.some((o) => o.kind === "transient");
  let status: PushStatus;
  if (ok.length) status = "sent";
  else if (transient && attempts < pushConfig.maxAttempts) status = "retrying";
  else if (gone.length === subs.length) status = "no_device";
  else status = "failed";
  const wait = pushConfig.laterRetryMs[Math.min(attempts - 1, pushConfig.laterRetryMs.length - 1)];
  await finish(db, row.id, {
    status,
    attempts,
    devices: subs.length,
    delivered: ok.length,
    lastError: errors.length ? errors.join("; ").slice(0, 500) : gone.length === subs.length ? "The phone unsubscribed" : null,
    nextAttemptAt: status === "retrying" ? new Date(now.getTime() + wait) : null,
    sentAt: ok.length ? now : null,
  });
  if (status !== "sent") console.warn(`[push] ${status} for user ${row.userId}: ${errors.join("; ") || "no live phone"}`);
  return { userId: row.userId, status, delivered: ok.length };
}

async function finish(
  db: Db,
  id: string,
  set: { status: PushStatus; attempts: number; devices: number; delivered: number; lastError: string | null; nextAttemptAt?: Date | null; sentAt?: Date | null },
) {
  await db
    .update(schema.pushNotifications)
    .set({ ...set, nextAttemptAt: set.nextAttemptAt ?? null, sentAt: set.sentAt ?? null, updatedAt: new Date() })
    .where(eq(schema.pushNotifications.id, id));
}

type Subscription = typeof schema.pushSubscriptions.$inferSelect;

async function sendWithRetry(s: Subscription, body: string, urgent: boolean): Promise<Outcome> {
  let last: Outcome = { kind: "transient", error: "not sent" };
  for (let i = 0; i <= pushConfig.retryDelaysMs.length; i++) {
    if (i > 0) await sleep(Math.min("retryAfterMs" in last && last.retryAfterMs ? last.retryAfterMs : pushConfig.retryDelaysMs[i - 1], 2000));
    last = await sendOnce(s, body, urgent);
    if (last.kind !== "transient") return last;
  }
  return last;
}

async function sendOnce(s: Subscription, body: string, urgent: boolean): Promise<Outcome> {
  try {
    await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
      TTL: urgent ? 300 : 3600,
      urgency: urgent ? "high" : "normal",
      timeout: pushConfig.timeoutMs,
    });
    return { kind: "ok" };
  } catch (error) {
    if (error instanceof WebPushError) {
      const code = error.statusCode;
      if (code === 404 || code === 410) return { kind: "gone" };
      const message = `${code} ${(error.body || error.message || "").toString().slice(0, 200)}`.trim();
      if (code === 429 || code >= 500) {
        const after = Number(error.headers?.["retry-after"]);
        return { kind: "transient", error: message, retryAfterMs: Number.isFinite(after) && after > 0 ? after * 1000 : undefined };
      }
      return { kind: "permanent", error: message };
    }
    // No answer from the push service (timeout, DNS, connection reset): try again.
    return { kind: "transient", error: error instanceof Error ? error.message : String(error) };
  }
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Delivery state of notifications by dedupe key, for the sender's "they may not see it" fallback. */
export async function pushStatusByKey(db: Db, keys: string[]) {
  if (!keys.length) return new Map<string, { userId: string; status: PushStatus }>();
  const rows = await db.query.pushNotifications.findMany({ where: inArray(schema.pushNotifications.dedupeKey, keys) });
  return new Map(rows.map((r) => [`${r.dedupeKey}|${r.userId}`, { userId: r.userId, status: r.status }]));
}
