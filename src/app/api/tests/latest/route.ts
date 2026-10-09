import { aiAvailable } from "@/lib/check/ai";
import { gateModelInfo } from "@/lib/check/gate";
import { getDb } from "@/lib/db";
import { route } from "@/lib/server/http";
import { latestRun } from "@/lib/server/testset";

export const GET = route(async () => {
  return { run: await latestRun(await getDb()), aiAvailable: aiAvailable(), gate: gateModelInfo() };
});
