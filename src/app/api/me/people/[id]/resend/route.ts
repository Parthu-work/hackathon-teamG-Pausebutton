import { route } from "@/lib/server/http";
import { resendCode } from "@/lib/server/people";
import { requireUser } from "@/lib/server/session";

export const POST = route(async (_req, { id }) => {
  const { db, user } = await requireUser("rao");
  return resendCode(db, user, id);
});
