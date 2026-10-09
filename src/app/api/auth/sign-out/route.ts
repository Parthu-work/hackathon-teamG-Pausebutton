import { z } from "zod";
import { readBody, route } from "@/lib/server/http";
import { clearSession } from "@/lib/server/session";

export const POST = route(async (req) => {
  const { app } = await readBody(req, z.object({ app: z.enum(["rao", "family"]) }));
  await clearSession(app);
  return { redirect: "/welcome" };
});
