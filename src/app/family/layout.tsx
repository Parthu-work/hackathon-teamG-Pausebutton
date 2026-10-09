import { Suspense } from "react";
import { FamilyShell } from "@/screens/family/shell";

/** Arjun's phone (route /family). Polls the service every 2 s. */
export default function FamilyLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <FamilyShell>{children}</FamilyShell>
    </Suspense>
  );
}
