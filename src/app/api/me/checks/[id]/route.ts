import { getCheckView } from "@/lib/server/checks";
import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

export const GET = route(async (_req, { id }) => {
  const { db, user } = await requireUser("rao");
  return getCheckView(db, id, { ownerId: user.id });
});
