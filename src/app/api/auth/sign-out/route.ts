import { z } from "zod";
import { getDb } from "@/lib/db";
import { readBody, route } from "@/lib/server/http";
import { removeSubscription } from "@/lib/server/push";
import { clearSession, sessionUserId } from "@/lib/server/session";

/**
 * Signs this app out. With `endpoint` (this phone's push subscription) the phone
 * also stops getting this person's alerts: they must not reach the lock screen
 * after they signed out, or when someone else signs in on this phone.
 */
export const POST = route(async (req) => {
  const { app, endpoint } = await readBody(req, z.object({ app: z.enum(["rao", "family"]), endpoint: z.string().optional() }));
  const userId = await sessionUserId(app);
  if (userId && endpoint) await removeSubscription(await getDb(), userId, endpoint);
  await clearSession(app);
  return { redirect: "/welcome" };
});
