import { getDb } from "@/lib/db";
import { route } from "@/lib/server/http";
import { requireCron } from "@/lib/server/retention";
import { runSync } from "@/lib/server/sync";

/** The 30-minute sync job (src/lib/server/sync.ts). POST from GitHub Actions (.github/workflows/sync.yml); GET is what Vercel Cron sends. */
export const POST = route(async (req) => {
  requireCron(req);
  return runSync(await getDb());
});

export const GET = POST;
