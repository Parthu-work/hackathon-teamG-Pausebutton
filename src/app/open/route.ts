import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { familyAlertDestination, parseOpen } from "@/lib/server/open";
import { sessionUserId } from "@/lib/server/session";

/**
 * A tapped push notification lands here (see src/lib/server/open.ts). Signed
 * out: sign in first and come back. Signed in: go straight to the screen.
 * Redirects are relative, so they work behind tunnels and proxies too.
 */
export async function GET(req: Request) {
  await connection();
  const url = new URL(req.url);
  const target = parseOpen(url.searchParams);
  if (!target) return go("/");
  try {
    const userId = await sessionUserId(target.app);
    if (!userId) return go(`/welcome?next=${encodeURIComponent(`/open${url.search}`)}`);
    if (target.app === "rao") return go(target.to);
    return go(await familyAlertDestination(await getDb(), userId, target.alertId));
  } catch (error) {
    console.error("[open]", error);
    return go(target.app === "family" ? "/family" : "/");
  }
}

const go = (location: string) => new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });
