import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { logEvent } from "./events";

// Deep links from push notifications. A notification carries /open?…, which
// works whatever state the app is in: already open, in the background, or
// closed and signed out (the person signs in first, then lands on it).
//   /open?alert=<id>                 a family member's alert
//   /open?app=rao&to=/hold/<id>      a screen on the protected person's phone

export type OpenTarget = { app: "family"; alertId: string } | { app: "rao"; to: string };

const ID = /^[A-Za-z0-9-]{1,64}$/;
const RAO_PATH = /^\/(hold|check)\/[A-Za-z0-9-]{1,64}$/;

export function parseOpen(params: URLSearchParams): OpenTarget | null {
  const alert = params.get("alert");
  if (alert) return ID.test(alert) ? { app: "family", alertId: alert } : null;
  const to = params.get("to");
  if (params.get("app") === "rao" && to && RAO_PATH.test(to)) return { app: "rao", to };
  return null;
}

/**
 * I1 → I2: the family member opened the alert ("status seen"). Idempotent:
 * only the first open is logged. Returns null if it is not their alert.
 */
export async function markAlertOpened(db: Db, user: { id: string; name: string }, alertId: string, via?: "push") {
  const [alert] = await db
    .update(schema.alerts)
    .set({ openedAt: new Date() })
    .where(and(eq(schema.alerts.id, alertId), eq(schema.alerts.recipientId, user.id), isNull(schema.alerts.openedAt)))
    .returning();
  if (!alert) return db.query.alerts.findFirst({ where: and(eq(schema.alerts.id, alertId), eq(schema.alerts.recipientId, user.id)) });
  const check = await db.query.checks.findFirst({ where: eq(schema.checks.id, alert.checkId) });
  const how = via === "push" ? " from the notification" : "";
  if (check) await logEvent(db, check.userId, user.name, "opened", `${user.name} opened it${how} · status seen`, alert.holdId);
  return alert;
}

/**
 * Where a tapped family notification leads: straight to the payment or the
 * message, even after someone else already decided it (the screen then shows
 * the outcome). Someone else's alert (another person signed in on this phone)
 * leads to their own home, never to that alert.
 */
export async function familyAlertDestination(db: Db, userId: string, alertId: string): Promise<string> {
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user) return "/family";
  const alert = await markAlertOpened(db, user, alertId, "push");
  if (!alert) return "/family";
  return alert.holdId ? `/family/hold/${alert.holdId}?via=push` : `/family/check/${alert.checkId}?alert=${alert.id}&via=push`;
}
