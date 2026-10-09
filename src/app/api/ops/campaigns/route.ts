import { getDb } from "@/lib/db";
import { route } from "@/lib/server/http";
import { requireOperator } from "@/lib/server/operator";
import { campaignsView } from "@/lib/server/sightings";

/** F3b · Operator: campaigns grouped by fingerprint, last 24 hours. */
export const GET = route(async (req) => {
  requireOperator(req);
  return campaignsView(await getDb());
});
