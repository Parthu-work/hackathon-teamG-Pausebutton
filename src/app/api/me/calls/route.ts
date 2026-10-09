import { z } from "zod";
import { createCallCheck } from "@/lib/server/calls";
import { readBody, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

/** F6 · Live-call guard: three answers in, a verdict and the family alert out. */
export const POST = route(async (req) => {
  const { db, user } = await requireUser("rao");
  const answers = await readBody(req, z.object({ video: z.boolean(), money: z.boolean(), secrecy: z.boolean() }));
  return createCallCheck(db, user, answers);
});
