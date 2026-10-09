import { getDb } from "@/lib/db";
import { route } from "@/lib/server/http";
import { disagreementsView } from "@/lib/server/ops";

/** F4 · Operator: where families overruled the check, last 30 days. */
export const GET = route(async () => disagreementsView(await getDb()));
