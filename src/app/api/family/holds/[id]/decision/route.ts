import { z } from "zod";
import { decideHold } from "@/lib/server/holds";
import { readBody, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

/** I2/I3: Block, or Approve with a second confirm. */
export const POST = route(async (req, { id }) => {
  const { db, user } = await requireUser("family");
  const body = await readBody(req, z.object({ decision: z.enum(["block", "approve"]), confirm: z.boolean().default(false) }));
  return decideHold(db, user, id, body.decision, body.confirm);
});
