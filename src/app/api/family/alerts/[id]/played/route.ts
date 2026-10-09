import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { logEvent } from "@/lib/server/events";
import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

/** The phone reports that the buzz, flash and sound played (for the demo log). */
export const POST = route(async (_req, { id }) => {
  const { db, user } = await requireUser("family");
  const alert = await db.query.alerts.findFirst({ where: and(eq(schema.alerts.id, id), eq(schema.alerts.recipientId, user.id)) });
  if (!alert) return;
  const check = await db.query.checks.findFirst({ where: eq(schema.checks.id, alert.checkId) });
  const what = alert.kind === "urgent" ? "Buzz, flash and sound played" : "Short sound and buzz played";
  if (check) await logEvent(db, check.userId, user.name, "played", `${what} on ${user.name}'s phone`, alert.holdId);
});
