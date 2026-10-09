import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { holdTimeline } from "@/lib/server/events";
import { assertLinked, toHoldView } from "@/lib/server/holds";
import { route } from "@/lib/server/http";
import { HttpError, requireUser } from "@/lib/server/session";

export const GET = route(async (_req, { id }) => {
  const { db, user } = await requireUser("family");
  const hold = await db.query.holds.findFirst({ where: eq(schema.holds.id, id) });
  if (!hold) throw new HttpError(404, "That payment was not found.");
  await assertLinked(db, user, hold.userId);
  return { hold: await toHoldView(db, hold), timeline: await holdTimeline(db, id), serverNow: new Date().toISOString() };
});
