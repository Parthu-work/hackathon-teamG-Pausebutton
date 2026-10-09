import { assetLinks } from "@/lib/server/devices";

/** Digital Asset Links for the Android app (full-screen Trusted Web Activity). */
export function GET() {
  return Response.json(assetLinks(), { headers: { "cache-control": "public, max-age=3600" } });
}
