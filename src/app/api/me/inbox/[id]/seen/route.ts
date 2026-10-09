import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { markBannerSeen } from "@/lib/server/sim";

export const POST = route(async (_req, { id }) => {
  const { db, user } = await requireUser("rao");
  await markBannerSeen(db, user, id);
});
