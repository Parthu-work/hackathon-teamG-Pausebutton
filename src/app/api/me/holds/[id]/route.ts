import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { reachForCheck } from "@/lib/server/checks";
import { toHoldView } from "@/lib/server/holds";
import { route } from "@/lib/server/http";
import { HttpError, requireUser } from "@/lib/server/session";

export const GET = route(async (_req, { id }) => {
  const { db, user } = await requireUser("rao");
  const hold = await db.query.holds.findFirst({ where: and(eq(schema.holds.id, id), eq(schema.holds.userId, user.id)) });
  if (!hold) throw new HttpError(404, "That payment was not found.");
  // reach: whether the family alert reached anyone, so he calls instead of waiting.
  return { hold: await toHoldView(db, hold), reach: await reachForCheck(db, hold.checkId), serverNow: new Date().toISOString() };
});
