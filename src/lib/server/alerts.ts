import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { logEvent } from "./events";
import { HttpError } from "./session";

type User = typeof schema.users.$inferSelect;
type Alert = typeof schema.alerts.$inferSelect;

/** Where an alert opens: its paused payment, or the message with the alert in hand. */
export function alertUrl(alert: Pick<Alert, "id" | "checkId" | "holdId">) {
  return alert.holdId ? `/family/hold/${alert.holdId}` : `/family/check/${alert.checkId}?alert=${alert.id}`;
}

/**
 * The family member opened an alert (I1 → I2, "status seen"). Idempotent: only
 * the first open is recorded. `via` says whether it was the in-app alert screen
 * or a tap on the system notification (both show in the demo log).
 */
export async function markAlertOpened(db: Db, member: User, alertId: string, via: "app" | "notification" = "app") {
  const [opened] = await db
    .update(schema.alerts)
    .set({ openedAt: new Date() })
    .where(and(eq(schema.alerts.id, alertId), eq(schema.alerts.recipientId, member.id), isNull(schema.alerts.openedAt)))
    .returning();
  const alert = opened ?? (await db.query.alerts.findFirst({ where: and(eq(schema.alerts.id, alertId), eq(schema.alerts.recipientId, member.id)) }));
  if (!alert) throw new HttpError(404, "Alert not found.");
  if (opened) {
    const check = await db.query.checks.findFirst({ where: eq(schema.checks.id, alert.checkId) });
    if (check) await logEvent(db, check.userId, member.name, "opened", `${member.name} opened it${via === "notification" ? " from the notification" : ""} · status seen`, alert.holdId);
  }
  return alert;
}

/**
 * A tap on a push notification: mark the alert opened and say which screen to
 * show. Works for an alert that was already handled (the other sibling blocked
 * it): the tap then shows the payment's outcome, never the home screen.
 */
export async function openAlertFromNotification(db: Db, member: User, alertId: string) {
  const alert = await markAlertOpened(db, member, alertId, "notification");
  return { id: alert.id, kind: alert.kind, checkId: alert.checkId, holdId: alert.holdId, handled: !!alert.handledAt, url: alertUrl(alert) };
}
