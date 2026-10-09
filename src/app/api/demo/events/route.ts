import { getDb } from "@/lib/db";
import { personaUser } from "@/lib/server/demo";
import { listEvents } from "@/lib/server/events";
import { route } from "@/lib/server/http";

/** L2 live event log for the demo household (both protected people). */
export const GET = route(async (req) => {
  const db = await getDb();
  const owners = (await Promise.all([personaUser(db, "rao"), personaUser(db, "mom")])).flatMap((u) => (u ? [u.id] : []));
  const since = Number(new URL(req.url).searchParams.get("since") ?? 0);
  return { events: owners.length ? await listEvents(db, owners, since) : [], serverNow: new Date().toISOString() };
});
