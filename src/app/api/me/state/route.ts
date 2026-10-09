import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { raoState } from "@/lib/server/state";

/** Polled every 2 s by Mr Rao's phone. */
export const GET = route(async () => {
  const { db, user } = await requireUser("rao");
  return raoState(db, user);
});
