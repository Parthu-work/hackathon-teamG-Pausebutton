import { z } from "zod";
import { getDb } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { readBody, route } from "@/lib/server/http";
import { assertResendOpen, issueCode, markShown, otpSender, retireCode } from "@/lib/server/otp";
import { rateLimit } from "@/lib/server/ratelimit";
import { demoSignInOpen, HttpError, requireDemoSignIn } from "@/lib/server/session";

/**
 * A1 step 1 "Send code" (and "Resend code"): a fresh 4-digit code for this
 * number; the one before stops working. With the demo sender the code comes
 * back in this response only, to be shown on screen once (and only while demo
 * sign-in is on); no other endpoint ever returns it, and only its HMAC is kept.
 */
export const POST = route(async (req) => {
  const sender = otpSender();
  if (sender.name === "demo") requireDemoSignIn();
  const db = await getDb();
  const body = await readBody(req, z.object({ phone: z.string() }));
  const phone = formatPhone(body.phone);
  const now = new Date();
  // Tapping Send again inside the 30 s wait gets the seconds left, and uses up
  // none of the requests the limits below allow (no code is made or sent).
  if (phone) await assertResendOpen(db, phone, now);
  await rateLimit(db, req, "signInCode", phone ?? undefined);
  if (!phone) throw new HttpError(400, "Please enter a 10-digit mobile number.");
  const issued = await issueCode(db, phone, now);
  let shownCode: string | undefined;
  try {
    ({ shownCode } = await sender.send(phone, issued.code));
  } catch (error) {
    await retireCode(db, issued.id);
    throw error;
  }
  const demoCode = shownCode && demoSignInOpen() ? shownCode : undefined;
  if (demoCode) await markShown(db, issued.id);
  return {
    phone,
    expiresAt: issued.expiresAt.toISOString(),
    resendAt: issued.resendAt.toISOString(),
    serverNow: now.toISOString(),
    ...(demoCode ? { demoCode } : {}),
  };
});
