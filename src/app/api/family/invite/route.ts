import { route } from "@/lib/server/http";
import { previewInvite } from "@/lib/server/people";
import { requireUser } from "@/lib/server/session";

/** C1: who is asking, before accepting. */
export const GET = route(async (req) => {
  const { db } = await requireUser("family");
  const code = new URL(req.url).searchParams.get("code") ?? "";
  return { invite: await previewInvite(db, code) };
});
