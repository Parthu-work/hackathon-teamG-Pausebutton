import { Suspense } from "react";
import { RaoShell } from "@/screens/rao/shell";

/**
 * F1 · /share is where the phone's Share sheet lands. It is not behind the
 * server-side sign-in check on purpose: a signed-out phone must keep the
 * forwarded text through the welcome and sign-in screens, so the screen itself
 * stashes it and the shell sends the person to sign in.
 */
export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <RaoShell>{children}</RaoShell>
    </Suspense>
  );
}
