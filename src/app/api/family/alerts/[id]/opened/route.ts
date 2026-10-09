import { route } from "@/lib/server/http";
import { markAlertOpened } from "@/lib/server/open";
import { HttpError, requireUser } from "@/lib/server/session";

/** I1 → I2: the family member opened the alert ("status seen"). */
export const POST = route(async (_req, { id }) => {
  const { db, user } = await requireUser("family");
  if (!(await markAlertOpened(db, user, id))) throw new HttpError(404, "Alert not found.");
});
