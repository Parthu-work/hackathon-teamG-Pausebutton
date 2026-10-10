import { connection } from "next/server";
import { assetLinks } from "@/lib/server/devices";

/**
 * Digital Asset Links. The Android app no longer needs them (it is a Capacitor
 * app, not a Trusted Web Activity), but phones still on the 0.2 wrapper read
 * this file until they update, so it stays: read per request, from
 * ANDROID_CERT_SHA256 on the host, and an empty list when that is not set.
 */
export async function GET() {
  await connection();
  return Response.json(assetLinks(), { headers: { "cache-control": "public, max-age=3600" } });
}
