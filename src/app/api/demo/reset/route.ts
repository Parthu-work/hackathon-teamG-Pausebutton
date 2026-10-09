import { getDb } from "@/lib/db";
import { resetDemo } from "@/lib/server/demo";
import { route } from "@/lib/server/http";
import { requireOperator } from "@/lib/server/operator";

/** L2 / J4 "Reset demo data". */
export const POST = route(async (req) => {
  requireOperator(req);
  await resetDemo(await getDb());
});
