import { z } from "zod";
import { getDb } from "@/lib/db";
import { personaUser } from "@/lib/server/demo";
import { readBody, route } from "@/lib/server/http";
import { setSession } from "@/lib/server/session";

/** A1 "Continue as Mr Rao (demo)" / "Continue as Arjun (demo)". */
export const POST = route(async (req) => {
  const { persona } = await readBody(req, z.object({ persona: z.enum(["rao", "arjun"]) }));
  const db = await getDb();
  const user = (await personaUser(db, persona))!;
  await setSession(persona === "rao" ? "rao" : "family", user.id);
  return { redirect: persona === "rao" ? "/" : "/family" };
});
