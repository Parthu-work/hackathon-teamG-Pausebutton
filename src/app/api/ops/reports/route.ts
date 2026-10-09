import { getDb } from "@/lib/db";
import { route } from "@/lib/server/http";
import { requireOperator } from "@/lib/server/operator";
import { listReports } from "@/lib/server/reports";

/** F9b · Operator: family-reported domains waiting for review. */
export const GET = route(async (req) => {
  requireOperator(req);
  return listReports(await getDb());
});
