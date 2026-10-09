import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { familyActivity } from "@/lib/server/state";

export const GET = route(async () => {
  const { db, user } = await requireUser("family");
  return familyActivity(db, user);
});
