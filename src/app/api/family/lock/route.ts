import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { lockView } from "@/lib/server/state";

/** F2 · What the lock screen shows: the newest urgent alert and its paused payment. */
export const GET = route(async () => {
  const { db, user } = await requireUser("family");
  return lockView(db, user);
});
