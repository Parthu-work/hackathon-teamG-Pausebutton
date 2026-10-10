import { z } from "zod";
import { MAX_MESSAGE_CHARS } from "@/lib/check/pipeline";
import { getDb } from "@/lib/db";
import { deviceByToken, deviceInbox, watchSettings } from "@/lib/server/devices";
import { readBody, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";

/** The phone's id for one message in its outbox (a UUID): the same message posted again is not checked twice. */
const messageId = z.string().regex(/^[A-Za-z0-9-]{8,100}$/, "Bad message id.");

/**
 * The phone's message watcher posts an SMS or WhatsApp message it just saw
 * (or, every 30 minutes, one still waiting in its outbox). The header
 * Idempotency-Key (or the body's messageId) names the message; older apps
 * send neither and are not deduplicated. 200: checked, skipped or already
 * posted. 202: our own check failed; the phone counts it delivered and the
 * server's sync job checks it again.
 */
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
      messageId: messageId.optional(),
    }),
  );
  const header = req.headers.get("idempotency-key");
  const key = header !== null ? messageId.parse(header.trim()) : (body.messageId ?? null);
  const row = await deviceInbox(db, device, user, { channel: body.channel, sender: body.sender, fromContact: body.fromContact, text: body.text }, key);
  // settings: so the phone keeps applying what the person chose, without asking separately.
  const settings = watchSettings(user);
  if (row.status === "failed") return Response.json({ id: row.id, checkId: null, status: row.status, duplicate: row.duplicate, settings }, { status: 202 });
  return { id: row.id, checkId: row.checkId, status: row.status, duplicate: row.duplicate, settings };
});
