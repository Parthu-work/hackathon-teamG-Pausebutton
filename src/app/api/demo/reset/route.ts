import { getDb } from "@/lib/db";
import { resetDemo } from "@/lib/server/demo";
import { route } from "@/lib/server/http";

/** L2 / J4 "Reset demo data". */
export const POST = route(async () => {
  await resetDemo(await getDb());
});
