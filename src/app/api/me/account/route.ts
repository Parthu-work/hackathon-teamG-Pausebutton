import { deleteAccount } from "@/lib/server/account";
import { route } from "@/lib/server/http";
import { clearSessionsOf, requireUser } from "@/lib/server/session";

/** P3 "Delete my account" (docs/retention.md). */
export const DELETE = route(async () => {
  const { db, user } = await requireUser("rao");
  await deleteAccount(db, user);
  await clearSessionsOf(user.id);
  return { redirect: "/welcome" };
});
