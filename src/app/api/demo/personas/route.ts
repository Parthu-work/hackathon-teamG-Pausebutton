import { getDb } from "@/lib/db";
import { personaUser } from "@/lib/server/demo";
import { route } from "@/lib/server/http";
import { requireOperator } from "@/lib/server/operator";
import { setSession } from "@/lib/server/session";

/** L2: signs this browser in as both Mr Rao (/) and Arjun (/family). */
export const POST = route(async (req) => {
  requireOperator(req);
  const db = await getDb();
  await setSession("rao", (await personaUser(db, "rao"))!.id);
  await setSession("family", (await personaUser(db, "arjun"))!.id);
});
