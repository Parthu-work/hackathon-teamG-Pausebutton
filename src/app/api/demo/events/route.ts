import { getDb } from "@/lib/db";
import { personaUser } from "@/lib/server/demo";
import { listEvents } from "@/lib/server/events";
import { route } from "@/lib/server/http";

/** L2 live event log for the demo household. */
export const GET = route(async (req) => {
  const db = await getDb();
  const rao = await personaUser(db, "rao");
  const since = Number(new URL(req.url).searchParams.get("since") ?? 0);
  return { events: rao ? await listEvents(db, rao.id, since) : [], serverNow: new Date().toISOString() };
});
