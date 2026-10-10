import { getDb } from "@/lib/db";
import { route } from "@/lib/server/http";
import { requireOperator } from "@/lib/server/operator";
import { syncHealth } from "@/lib/server/sync";

/** Operator: the 30-minute sync job's last runs (what each fixed, or why it failed), and whether a run is overdue. */
export const GET = route(async (req) => {
  requireOperator(req);
  return syncHealth(await getDb());
});
