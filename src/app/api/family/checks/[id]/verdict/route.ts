import { z } from "zod";
import { setFamilyVerdict } from "@/lib/server/checks";
import { readBody, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

/** O2 / "Ask Arjun" answer: it's a scam, or this is not a scam. */
export const POST = route(async (req, { id }) => {
  const { db, user } = await requireUser("family");
  const body = await readBody(
    req,
    z.object({ verdict: z.enum(["scam", "not_scam"]), note: z.string().trim().max(200).optional() }),
  );
  await setFamilyVerdict(db, user, id, body.verdict, body.note);
});
