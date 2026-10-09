import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { familyState } from "@/lib/server/state";

/** Polled every 2 s by Arjun's phone. */
export const GET = route(async () => {
  const { db, user } = await requireUser("family");
  return familyState(db, user);
});
