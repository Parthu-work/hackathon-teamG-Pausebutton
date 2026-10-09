import { route } from "@/lib/server/http";
import { familyLedger } from "@/lib/server/ledger";
import { requireUser } from "@/lib/server/session";

/** F12 · The household ledger: this month's paused payments, in rupees. */
export const GET = route(async () => {
  const { db, user } = await requireUser("family");
  return familyLedger(db, user);
});
