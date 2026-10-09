import { z } from "zod";
import { getDb } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { readBody, route } from "@/lib/server/http";
import { issueCode, markShown, otpSender } from "@/lib/server/otp";
import { rateLimit } from "@/lib/server/ratelimit";
import { demoSignInOpen, HttpError, requireDemoSignIn } from "@/lib/server/session";

/**
 * A1 step 1 "Send code": a fresh 4-digit code for this number. With the demo
 * sender the code comes back in this response only, to be shown on screen
 * once (and only while demo sign-in is on); no other endpoint ever returns it.
 */
export const POST = route(async (req) => {
  const sender = otpSender();
  if (sender.name === "demo") requireDemoSignIn();
  const db = await getDb();
  const body = await readBody(req, z.object({ phone: z.string() }));
  const phone = formatPhone(body.phone);
  await rateLimit(db, req, "signIn", phone ?? undefined);
  if (!phone) throw new HttpError(400, "Please enter a 10-digit mobile number.");
  const issued = await issueCode(db, phone);
  const { shownCode } = await sender.send(phone, issued.code);
  const demoCode = shownCode && demoSignInOpen() ? shownCode : undefined;
  if (demoCode) await markShown(db, issued.id);
  return { expiresAt: issued.expiresAt.toISOString(), resendAt: issued.resendAt.toISOString(), ...(demoCode ? { demoCode } : {}) };
});
