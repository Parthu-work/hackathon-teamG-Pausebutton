import { redirect } from "next/navigation";
import { sessionUserId } from "@/lib/server/session";

/**
 * The other half of RequireSession, for the sign-in screens (welcome, sign-in):
 * someone already signed in on this phone goes straight to their own home, so
 * Back after signing in never lands on a stale sign-in form. Signing out
 * (Settings) is how to switch accounts.
 * Must sit inside <Suspense>: it reads cookies (runtime data).
 */
export async function RedirectIfSignedIn({ children }: { children: React.ReactNode }) {
  if (await sessionUserId("rao")) redirect("/");
  if (await sessionUserId("family")) redirect("/family");
  if (await sessionUserId("pending")) redirect("/role");
  return <>{children}</>;
}
