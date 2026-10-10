import { z } from "zod";
import { getDb } from "@/lib/db";
import { personaUser } from "@/lib/server/demo";
import { readBody, route } from "@/lib/server/http";
import { otpSender } from "@/lib/server/otp";
import { rateLimit } from "@/lib/server/ratelimit";
import { demoSignInOpen, requireDemoSignIn, setSession } from "@/lib/server/session";

/**
 * What the sign-in screen offers. open: the demo buttons (DEMO_SIGNIN).
 * codes: how a sign-in code arrives: "screen" (the demo sender, while demo
 * sign-in is on), "sms" (OTP_PROVIDER=sms), or "off" (no way in yet).
 */
export const GET = route(async () => {
  const open = demoSignInOpen();
  const codes = otpSender().name === "sms" ? "sms" : open ? "screen" : "off";
  return { open, codes };
});

/** A1 "Continue as Mr Rao / Mrs Rao / Arjun / Meera (demo)". */
export const POST = route(async (req) => {
  requireDemoSignIn();
  const db = await getDb();
  await rateLimit(db, req, "demoSignIn");
  const { persona } = await readBody(req, z.object({ persona: z.enum(["rao", "mom", "arjun", "meera"]) }));
  const user = (await personaUser(db, persona))!;
  const protectedPerson = user.role === "protected";
  await setSession(protectedPerson ? "rao" : "family", user.id);
  return { redirect: protectedPerson ? "/" : "/family" };
});
