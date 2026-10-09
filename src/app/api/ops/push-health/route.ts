import { getDb } from "@/lib/db";
import { route } from "@/lib/server/http";
import { requireOperator } from "@/lib/server/operator";
import { pushHealth } from "@/lib/server/push";

/** W3 · Operator: push delivery health per day (sent, failed, gone, confirmed, silent), last 14 days. */
export const GET = route(async (req) => {
  requireOperator(req);
  return pushHealth(await getDb());
});
