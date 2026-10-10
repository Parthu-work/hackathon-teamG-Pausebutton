import { z } from "zod";
import { getDb } from "@/lib/db";
import { deviceByToken, setDeviceStatus, toDeviceView, watchSettings } from "@/lib/server/devices";
import { readBody, route } from "@/lib/server/http";

/**
 * The phone reports whether notification access is on; also a cheap "am I
 * still connected?" check. Its 30-minute SyncWorker adds sync: true and how
 * many messages still wait in its outbox.
 */
export const POST = route(async (req) => {
  const db = await getDb();
  const { device, user } = await deviceByToken(db, req.headers.get("authorization"));
  const body = await readBody(
    req,
    z.object({ listenerOn: z.boolean(), waiting: z.number().int().min(0).max(1000).optional(), sync: z.boolean().optional() }),
  );
  const updated = await setDeviceStatus(db, device, body);
  return { ok: true, userName: user.name, device: toDeviceView(updated), settings: watchSettings(user) };
});

export const GET = route(async (req) => {
  const db = await getDb();
  const { device, user } = await deviceByToken(db, req.headers.get("authorization"));
  return { ok: true, userName: user.name, device: toDeviceView(device), settings: watchSettings(user) };
});
