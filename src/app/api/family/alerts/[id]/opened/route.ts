import { markAlertOpened } from "@/lib/server/alerts";
import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

/** I1 → I2: the family member opened the alert ("status seen"). */
export const POST = route(async (_req, { id }) => {
  const { db, user } = await requireUser("family");
  await markAlertOpened(db, user, id, "app");
});
