import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { listInbox, receiveNext } from "@/lib/server/sim";

export const GET = route(async () => {
  const { db, user } = await requireUser("rao");
  return listInbox(db, user.id);
});

/** P1 "Receive a test scam message". */
export const POST = route(async () => {
  const { db, user } = await requireUser("rao");
  const row = await receiveNext(db, user);
  return { id: row.id };
});
