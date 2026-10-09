import { redirect } from "next/navigation";
import { sessionUserId, type App } from "@/lib/server/session";

/**
 * Server-side sign-in check for a phone app. Without a session the request is
 * redirected to the welcome screen before anything renders, so a signed-out
 * visit never polls the API and never logs a 401 in the browser.
 * Must sit inside <Suspense>: it reads cookies (runtime data).
 */
export async function RequireSession({ app, children }: { app: Exclude<App, "pending">; children: React.ReactNode }) {
  if (!(await sessionUserId(app))) redirect("/welcome");
  return <>{children}</>;
}
