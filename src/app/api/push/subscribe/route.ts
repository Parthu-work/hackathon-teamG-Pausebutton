import { z } from "zod";
import { getDb } from "@/lib/db";
import { readBody, route } from "@/lib/server/http";
import { removeSubscription, replaceSubscription, saveSubscription, subscriptionSchema } from "@/lib/server/push";
import { HttpError, requireAnyUser } from "@/lib/server/session";

/**
 * A phone registers for alerts while the app is closed (C2 / J4 "Notifications"),
 * or re-registers when the browser rotated its subscription. The service worker
 * sends `oldEndpoint` then; it may have no session cookie, and the old endpoint
 * (a secret only that browser knows) says whose phone it is.
 */
export const POST = route(async (req) => {
  const body = await readBody(req, z.object({ subscription: subscriptionSchema, oldEndpoint: z.string().url().optional() }));
  const userAgent = req.headers.get("user-agent");
  const signedIn = await requireAnyUser().catch(() => null);
  if (signedIn) {
    if (body.oldEndpoint && body.oldEndpoint !== body.subscription.endpoint) await removeSubscription(signedIn.db, signedIn.user.id, body.oldEndpoint);
    await saveSubscription(signedIn.db, signedIn.user.id, body.subscription, userAgent);
    return;
  }
  if (body.oldEndpoint && (await replaceSubscription(await getDb(), body.oldEndpoint, body.subscription, userAgent))) return;
  throw new HttpError(401, "Please sign in.");
});

export const DELETE = route(async (req) => {
  const { db, user } = await requireAnyUser();
  const { endpoint } = await readBody(req, z.object({ endpoint: z.string() }));
  await removeSubscription(db, user.id, endpoint);
});
