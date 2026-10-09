import { askFamily } from "@/lib/server/checks";
import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

/** E2 "Ask Arjun". */
export const POST = route(async (_req, { id }) => {
  const { db, user } = await requireUser("rao");
  await askFamily(db, user, id);
});
