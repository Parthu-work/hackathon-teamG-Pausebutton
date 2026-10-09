import { and, eq, inArray } from "drizzle-orm";
import webpush, { WebPushError } from "web-push";
import { z } from "zod";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

// Web Push: family phones get a system notification (with vibration) even
// when the app is closed. Needs VAPID keys in the environment (`pnpm push:keys`);
// without them everything else works and this module just does nothing.

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
  urgent: boolean;
  /** F2: a paused payment the notification's buttons can block without opening the app. */
  holdId?: string | null;
  actions?: { action: "block" | "fine"; title: string }[];
  /** "Papa": for the follow-up notification after a lock-screen Block. */
  who?: string;
};

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

export async function saveSubscription(db: Db, userId: string, sub: SubscriptionInput, userAgent?: string | null) {
  const row = { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent ?? null };
  await db
    .insert(schema.pushSubscriptions)
    .values(row)
    .onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: row });
}

export async function removeSubscription(db: Db, userId: string, endpoint: string) {
  await db
    .delete(schema.pushSubscriptions)
    .where(and(eq(schema.pushSubscriptions.userId, userId), eq(schema.pushSubscriptions.endpoint, endpoint)));
}

/**
 * Sends one notification to every phone of each user. Phones that unsubscribed
 * (404/410 from the push service) are forgotten. Never throws: an alert must
 * not fail because a push did.
 */
export async function pushToUsers(db: Db, userIds: string[], payload: PushPayload): Promise<{ sent: number }> {
  if (!userIds.length || !configure()) return { sent: 0 };
  try {
    const rows = await db.query.pushSubscriptions.findMany({ where: inArray(schema.pushSubscriptions.userId, userIds) });
    if (!rows.length) return { sent: 0 };
    const results = await Promise.allSettled(
      rows.map((r) =>
        webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, JSON.stringify(payload), {
          TTL: payload.urgent ? 300 : 3600,
          urgency: payload.urgent ? "high" : "normal",
        }),
      ),
    );
    const dead: string[] = [];
    const alive: string[] = [];
    results.forEach((res, i) => {
      if (res.status === "fulfilled") alive.push(rows[i].id);
      else if (res.reason instanceof WebPushError && (res.reason.statusCode === 404 || res.reason.statusCode === 410)) dead.push(rows[i].id);
      else console.warn("[push] could not send:", res.reason instanceof Error ? res.reason.message : res.reason);
    });
    if (dead.length) await db.delete(schema.pushSubscriptions).where(inArray(schema.pushSubscriptions.id, dead));
    if (alive.length) await db.update(schema.pushSubscriptions).set({ lastUsedAt: new Date() }).where(inArray(schema.pushSubscriptions.id, alive));
    return { sent: alive.length };
  } catch (error) {
    console.warn("[push] failed:", error instanceof Error ? error.message : error);
    return { sent: 0 };
  }
}
