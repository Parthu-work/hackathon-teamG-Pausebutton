import { getDb } from "@/lib/db";
import simData from "@/data/sim-messages.json";
import { personaUser } from "@/lib/server/demo";
import { readBody, route } from "@/lib/server/http";
import { z } from "zod";
import { deliverMessage, type SimInput } from "@/lib/server/sim";

/** L2 "Run a scam sample": the CBI message arrives on Mr Rao's (or Mrs Rao's) simulated phone. */
export const POST = route(async (req) => {
  const { persona } = await readBody(req, z.object({ persona: z.enum(["rao", "mom"]).default("rao") }));
  const db = await getDb();
  const owner = (await personaUser(db, persona))!;
  const row = await deliverMessage(db, owner, simData.library[0] as SimInput);
  return { id: row.id, name: owner.name };
});
