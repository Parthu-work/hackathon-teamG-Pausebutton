import { z } from "zod";
import { readBody, route } from "@/lib/server/http";
import { removeSubscription, saveFcmToken, saveSubscription, subscriptionSchema } from "@/lib/server/push";
import { requireAnyUser, requireUser } from "@/lib/server/session";

const appSchema = z.enum(["rao", "family"]).optional();

/** The phone says which app it is (Mr Rao's or a family member's); the service worker, which cannot know, leaves it out. */
async function whoever(app: "rao" | "family" | undefined) {
  return app ? requireUser(app) : requireAnyUser();
}

/**
 * A phone registers for alerts while the app is closed (C2 / J4 "Notifications",
 * K2 on Mr Rao's phone). Sent again on every app start, so a phone another
 * person signs in on moves to them. A browser sends its Web Push subscription
 * (and `previousEndpoint`, forgotten, after the push service replaced it); the
 * Android app sends its FCM token, kept as endpoint "fcm:<token>".
 */
export const POST = route(async (req) => {
  const body = await readBody(
    req,
    z.union([
      z.object({ fcmToken: z.string().min(10).max(4096), app: appSchema }),
      z.object({ subscription: subscriptionSchema, previousEndpoint: z.string().nullish(), app: appSchema }),
    ]),
  );
  const { db, user } = await whoever(body.app);
  const userAgent = req.headers.get("user-agent");
  if ("fcmToken" in body) await saveFcmToken(db, user.id, body.fcmToken, userAgent);
  else await saveSubscription(db, user.id, body.subscription, userAgent, body.previousEndpoint ?? null);
});

/** "Notifications" off: this phone stops getting this person's alerts (a browser's endpoint, or "fcm:<token>"). */
export const DELETE = route(async (req) => {
  const body = await readBody(req, z.object({ endpoint: z.string(), app: appSchema }));
  const { db, user } = await whoever(body.app);
  await removeSubscription(db, user.id, body.endpoint);
});
