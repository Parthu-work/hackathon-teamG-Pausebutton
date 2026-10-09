import { z } from "zod";
import { addAdvice } from "@/lib/server/holds";
import { readBody, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

export const POST = route(async (req, { id }) => {
  const { db, user } = await requireUser("family");
  const { text } = await readBody(req, z.object({ text: z.string().trim().min(1).max(200) }));
  await addAdvice(db, user, { holdId: id }, text);
});
