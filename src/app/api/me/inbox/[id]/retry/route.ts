import { route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { requireUser } from "@/lib/server/session";
import { retryMessage } from "@/lib/server/sim";

/** "We could not check this message. Tap to check it again." */
export const POST = route(async (req, { id }) => {
  const { db, user } = await requireUser("rao");
  await rateLimit(db, req, "check", user.id); // before the checker can reach the Anthropic API
  const row = await retryMessage(db, user, id);
  return { id: row.id, checkId: row.checkId, status: row.status };
});
