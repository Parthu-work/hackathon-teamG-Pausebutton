import { z } from "zod";
import { getDb } from "@/lib/db";
import { pairDevice } from "@/lib/server/devices";
import { readBody, route } from "@/lib/server/http";

/** The Android app trades the pairing code for its token. */
export const POST = route(async (req) => {
  const body = await readBody(req, z.object({ code: z.string().min(4), name: z.string().max(60).default("Android phone") }));
  return pairDevice(await getDb(), body.code, body.name);
});
