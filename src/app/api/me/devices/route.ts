import { createPairing, listDevices } from "@/lib/server/devices";
import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

export const GET = route(async () => {
  const { db, user } = await requireUser("rao");
  return listDevices(db, user);
});

/** M2 "Connect this phone": a pairing code and a link that opens the Android app. */
export const POST = route(async (req) => {
  const { db, user } = await requireUser("rao");
  const h = req.headers;
  const origin = `${h.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")}://${h.get("x-forwarded-host") ?? h.get("host") ?? new URL(req.url).host}`;
  return createPairing(db, user, origin);
});
