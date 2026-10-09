import { z } from "zod";
import { getDb } from "@/lib/db";
import { readBody, route } from "@/lib/server/http";
import { runTestSet, saveRun } from "@/lib/server/testset";

export const maxDuration = 120;

/** L1 "Run on Haiku (fast)" / "Run on Sonnet (final)" / rules only. */
export const POST = route(async (req) => {
  const { mode } = await readBody(req, z.object({ mode: z.enum(["rules", "haiku", "sonnet"]) }));
  const run = await runTestSet(mode);
  return saveRun(await getDb(), run);
});
