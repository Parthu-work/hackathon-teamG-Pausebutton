import { getDb } from "@/lib/db";
import { route } from "@/lib/server/http";
import { purgeExpired, requireCron } from "@/lib/server/retention";

/** The hourly purge (docs/retention.md). POST from GitHub Actions; GET is what Vercel Cron sends. */
export const POST = route(async (req) => {
  requireCron(req);
  return purgeExpired(await getDb());
});

export const GET = POST;
