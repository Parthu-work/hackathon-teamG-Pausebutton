import { z } from "zod";
import { readBody, route } from "@/lib/server/http";
import { acceptInvite } from "@/lib/server/people";
import { requireUser } from "@/lib/server/session";

export const POST = route(async (req) => {
  const { db, user } = await requireUser("family");
  const { code } = await readBody(req, z.object({ code: z.string().min(4, "Type the code Papa shared with you.") }));
  return acceptInvite(db, user, code);
});
