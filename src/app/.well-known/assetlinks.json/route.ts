import { connection } from "next/server";
import { assetLinks } from "@/lib/server/devices";

/**
 * Digital Asset Links for the Android app (full-screen Trusted Web Activity).
 * Read per request, not prerendered at build time, so ANDROID_CERT_SHA256 set
 * on the host takes effect without a rebuild.
 */
export async function GET() {
  await connection();
  return Response.json(assetLinks(), { headers: { "cache-control": "public, max-age=3600" } });
}
