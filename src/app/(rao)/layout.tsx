import { Suspense } from "react";
import { RaoShell } from "@/screens/rao/shell";

/** Mr Rao's phone (route /). Polls the service every 2 s. */
export default function RaoLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <RaoShell>{children}</RaoShell>
    </Suspense>
  );
}
