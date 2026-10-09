import { getDb } from "@/lib/db";
import { personaUser } from "@/lib/server/demo";
import { route } from "@/lib/server/http";
import { sessionToken, setSession } from "@/lib/server/session";

/**
 * L2: signs this browser in as Mr Rao (/) and Arjun (/family), and returns a
 * token per persona so every phone frame on the panel knows whose it is.
 */
export const POST = route(async () => {
  const db = await getDb();
  const [rao, mom, arjun, meera] = await Promise.all([personaUser(db, "rao"), personaUser(db, "mom"), personaUser(db, "arjun"), personaUser(db, "meera")]);
  await setSession("rao", rao!.id);
  await setSession("family", arjun!.id);
  return { tokens: { rao: sessionToken(rao!.id), mom: sessionToken(mom!.id), arjun: sessionToken(arjun!.id), meera: sessionToken(meera!.id) } };
});
