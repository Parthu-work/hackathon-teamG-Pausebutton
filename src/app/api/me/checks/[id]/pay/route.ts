import { openPayment } from "@/lib/server/checks";
import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

/** G2: he opens the payment anyway. It is locked while family decides. */
export const POST = route(async (_req, { id }) => {
  const { db, user } = await requireUser("rao");
  return openPayment(db, user, id);
});
