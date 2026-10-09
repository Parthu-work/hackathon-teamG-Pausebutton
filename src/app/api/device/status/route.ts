import { z } from "zod";
import { getDb } from "@/lib/db";
import { deviceByToken, setDeviceStatus, toDeviceView } from "@/lib/server/devices";
import { readBody, route } from "@/lib/server/http";

/** The phone reports whether notification access is on; also a cheap "am I still connected?" check. */
export const POST = route(async (req) => {
  const db = await getDb();
  const { device, user } = await deviceByToken(db, req.headers.get("authorization"));
  const { listenerOn } = await readBody(req, z.object({ listenerOn: z.boolean() }));
  await setDeviceStatus(db, device, { listenerOn });
  return { ok: true, userName: user.name, device: toDeviceView({ ...device, listenerOn }) };
});

export const GET = route(async (req) => {
  const db = await getDb();
  const { device, user } = await deviceByToken(db, req.headers.get("authorization"));
  return { ok: true, userName: user.name, device: toDeviceView(device) };
});
