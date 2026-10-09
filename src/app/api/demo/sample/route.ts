import { getDb } from "@/lib/db";
import simData from "@/data/sim-messages.json";
import { personaUser } from "@/lib/server/demo";
import { route } from "@/lib/server/http";
import { deliverMessage, type SimInput } from "@/lib/server/sim";

/** L2 "Run a scam sample": the CBI message arrives on Mr Rao's simulated phone. */
export const POST = route(async () => {
  const db = await getDb();
  const rao = (await personaUser(db, "rao"))!;
  const row = await deliverMessage(db, rao, simData.library[0] as SimInput);
  return { id: row.id };
});
