import { z } from "zod";
import { getDb } from "@/lib/db";
import { readBody, route } from "@/lib/server/http";
import { requireOperator } from "@/lib/server/operator";
import { reviewDomain } from "@/lib/server/reports";

/** F9b · A reviewer blocks (joins the live blocklist), rejects, or un-blocks a reported domain. */
export const POST = route(async (req, { id }) => {
  requireOperator(req);
  const { decision } = await readBody(req, z.object({ decision: z.enum(["block", "reject", "unblock"]) }));
  return reviewDomain(await getDb(), id, decision);
});
