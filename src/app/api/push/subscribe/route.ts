import { z } from "zod";
import { readBody, route } from "@/lib/server/http";
import { removeSubscription, saveSubscription, subscriptionSchema } from "@/lib/server/push";
import { requireAnyUser } from "@/lib/server/session";

/** A phone registers for alerts while the app is closed (C2 / J4 "Notifications"). */
export const POST = route(async (req) => {
  const { db, user } = await requireAnyUser();
  const { subscription } = await readBody(req, z.object({ subscription: subscriptionSchema }));
  await saveSubscription(db, user.id, subscription, req.headers.get("user-agent"));
});

export const DELETE = route(async (req) => {
  const { db, user } = await requireAnyUser();
  const { endpoint } = await readBody(req, z.object({ endpoint: z.string() }));
  await removeSubscription(db, user.id, endpoint);
});
