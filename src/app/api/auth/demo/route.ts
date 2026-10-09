import { z } from "zod";
import { getDb } from "@/lib/db";
import { personaUser } from "@/lib/server/demo";
import { readBody, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { demoSignInOpen, requireDemoSignIn, setSession } from "@/lib/server/session";

/** Whether the sign-in screen offers sign-in at all (DEMO_SIGNIN). */
export const GET = route(async () => ({ open: demoSignInOpen() }));

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
