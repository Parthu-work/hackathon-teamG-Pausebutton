import { z } from "zod";
import { getDb } from "@/lib/db";
import { personaUser } from "@/lib/server/demo";
import { readBody, route } from "@/lib/server/http";
import { setSession } from "@/lib/server/session";

/** A1 "Continue as Mr Rao / Mrs Rao / Arjun / Meera (demo)". */
export const POST = route(async (req) => {
  const { persona } = await readBody(req, z.object({ persona: z.enum(["rao", "mom", "arjun", "meera"]) }));
  const db = await getDb();
  const user = (await personaUser(db, persona))!;
  const protectedPerson = user.role === "protected";
  await setSession(protectedPerson ? "rao" : "family", user.id);
  return { redirect: protectedPerson ? "/" : "/family" };
});
