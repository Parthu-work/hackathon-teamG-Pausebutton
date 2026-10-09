import { z } from "zod";
import { readBody, route } from "@/lib/server/http";
import { unlink } from "@/lib/server/people";
import { requireUser } from "@/lib/server/session";

export const POST = route(async (req) => {
  const { db, user } = await requireUser("family");
  const { linkId } = await readBody(req, z.object({ linkId: z.string() }));
  await unlink(db, user, linkId);
});
