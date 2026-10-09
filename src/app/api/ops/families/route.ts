import { getDb } from "@/lib/db";
import { route } from "@/lib/server/http";
import { familiesView } from "@/lib/server/ops";

/** F7 · Operator: our scam family against Claude's, on the last AI test run. */
export const GET = route(async () => familiesView(await getDb()));
