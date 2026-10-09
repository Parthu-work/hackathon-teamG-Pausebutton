import { route } from "@/lib/server/http";
import { cancelHold } from "@/lib/server/holds";
import { requireUser } from "@/lib/server/session";

export const POST = route(async (_req, { id }) => {
  const { db, user } = await requireUser("rao");
  await cancelHold(db, user, id);
});
