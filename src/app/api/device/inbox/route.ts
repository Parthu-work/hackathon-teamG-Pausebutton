import { z } from "zod";
import { MAX_MESSAGE_CHARS } from "@/lib/check/pipeline";
import { getDb } from "@/lib/db";
import { deviceByToken, deviceInbox, watchSettings } from "@/lib/server/devices";
import { readBody, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";

/** The phone's message watcher posts an SMS or WhatsApp message it just saw. */
export const POST = route(async (req) => {
  const db = await getDb();
  const { device, user } = await deviceByToken(db, req.headers.get("authorization"));
  await rateLimit(db, req, "inbox", device.id);
  const body = await readBody(
    req,
    z.object({
      channel: z.enum(["sms", "whatsapp"]),
      sender: z.string().trim().min(1).max(80),
      fromContact: z.boolean().default(false),
      text: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
    }),
  );
  const row = await deviceInbox(db, device, user, body);
  // settings: so the phone keeps applying what the person chose, without asking separately.
  return { id: row.id, checkId: row.checkId ?? null, settings: watchSettings(user) };
});
