import { openAlertFromNotification } from "@/lib/server/alerts";
import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

/**
 * A tap on a push notification (/open/<alertId>): marks the alert opened and
 * returns the screen to show: the paused payment, or the message. 404 when the
 * alert is not this person's; 401 when the phone is signed out (the screen then
 * keeps the destination through sign-in).
 */
export const POST = route(async (_req, { id }) => {
  const { db, user } = await requireUser("family");
  return openAlertFromNotification(db, user, id);
});
