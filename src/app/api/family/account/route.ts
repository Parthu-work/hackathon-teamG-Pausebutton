import { deleteAccount } from "@/lib/server/account";
import { route } from "@/lib/server/http";
import { clearSessionsOf, requireUser } from "@/lib/server/session";

/** J4 "Delete my account" (docs/retention.md). */
export const DELETE = route(async () => {
  const { db, user } = await requireUser("family");
  await deleteAccount(db, user);
  await clearSessionsOf(user.id);
  return { redirect: "/welcome" };
});
