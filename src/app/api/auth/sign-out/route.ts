import { z } from "zod";
import { getDb } from "@/lib/db";
import { readBody, route } from "@/lib/server/http";
import { removeSubscription } from "@/lib/server/push";
import { clearSession, sessionUserId } from "@/lib/server/session";

/**
 * Signs this phone out. The phone sends its push endpoint along, so the person
 * who signs out stops getting alerts on it: whoever signs in next registers
 * the phone afresh for themselves.
 */
export const POST = route(async (req) => {
  const { app, pushEndpoint } = await readBody(req, z.object({ app: z.enum(["rao", "family"]), pushEndpoint: z.string().nullish() }));
  const userId = await sessionUserId(app);
  if (userId && pushEndpoint) await removeSubscription(await getDb(), userId, pushEndpoint);
  await clearSession(app);
  return { redirect: "/welcome" };
});
