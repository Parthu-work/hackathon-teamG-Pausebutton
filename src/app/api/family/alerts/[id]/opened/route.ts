import { and, eq, isNull } from "drizzle-orm";
import { schema } from "@/lib/db";
import { logEvent } from "@/lib/server/events";
import { route } from "@/lib/server/http";
import { HttpError, requireUser } from "@/lib/server/session";

/** I1 → I2: the family member opened the alert ("status seen"). */
export const POST = route(async (_req, { id }) => {
  const { db, user } = await requireUser("family");
  const [alert] = await db
    .update(schema.alerts)
    .set({ openedAt: new Date() })
    .where(and(eq(schema.alerts.id, id), eq(schema.alerts.recipientId, user.id), isNull(schema.alerts.openedAt)))
    .returning();
  if (!alert) {
    const exists = await db.query.alerts.findFirst({ where: and(eq(schema.alerts.id, id), eq(schema.alerts.recipientId, user.id)) });
    if (!exists) throw new HttpError(404, "Alert not found.");
    return;
  }
  const check = await db.query.checks.findFirst({ where: eq(schema.checks.id, alert.checkId) });
  if (check) await logEvent(db, check.userId, user.name, "opened", `${user.name} opened it · status seen`, alert.holdId);
});
