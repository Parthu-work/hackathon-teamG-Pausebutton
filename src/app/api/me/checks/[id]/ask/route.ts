import { z } from "zod";
import { askFamily } from "@/lib/server/checks";
import { readBody, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

/** E2 "Ask Arjun". */
export const POST = route(async (req, { id }) => {
  const { db, user } = await requireUser("rao");
  const { text } = await readBody(req, z.object({ text: z.string().max(4000).optional() }));
  await askFamily(db, user, id, text);
});
