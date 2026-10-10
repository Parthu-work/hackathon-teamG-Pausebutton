import { z } from "zod";
import { getDb } from "@/lib/db";
import { readBody, route } from "@/lib/server/http";
import { recordReceipt } from "@/lib/server/push";

/**
 * The service worker (or, for FCM, the Android app itself) confirms a push: it
 * arrived, and the notification is on screen or could not be shown. No session
 * needed (a closed app may have none): the delivery id in the payload is the
 * credential, and the answer is the same whether or not it matched anything.
 */
export const POST = route(async (req) => {
  const { id, shown, error } = await readBody(
    req,
    z.object({ id: z.uuid(), shown: z.boolean(), error: z.string().max(80).nullish() }),
  );
  await recordReceipt(await getDb(), id, shown, error);
});
