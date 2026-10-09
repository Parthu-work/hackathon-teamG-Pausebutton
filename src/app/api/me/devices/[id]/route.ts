import { removeDevice } from "@/lib/server/devices";
import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

export const DELETE = route(async (_req, { id }) => {
  const { db, user } = await requireUser("rao");
  await removeDevice(db, user, id);
});
