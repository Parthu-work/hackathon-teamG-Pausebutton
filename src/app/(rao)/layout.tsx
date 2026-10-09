import { Suspense } from "react";
import { RequireSession } from "@/components/require-session";
import { RaoShell } from "@/screens/rao/shell";

/** Mr Rao's phone (route /). Polls the service every 2 s. */
export default function RaoLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <RequireSession app="rao">
        <RaoShell>{children}</RaoShell>
      </RequireSession>
    </Suspense>
  );
}
