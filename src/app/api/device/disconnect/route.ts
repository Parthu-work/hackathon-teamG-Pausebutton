import { getDb } from "@/lib/db";
import { deviceByToken, disconnectDevice } from "@/lib/server/devices";
import { route } from "@/lib/server/http";

/** The phone's own "Disconnect this phone": the token stops working and the web app forgets the phone. */
export const POST = route(async (req) => {
  const db = await getDb();
  const { device, user } = await deviceByToken(db, req.headers.get("authorization"));
  await disconnectDevice(db, device, user);
});
