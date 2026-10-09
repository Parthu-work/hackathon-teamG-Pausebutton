import { Suspense } from "react";
import { RequireSession } from "@/components/require-session";
import { FamilyShell } from "@/screens/family/shell";

/** A family member's phone (route /family): Arjun, Meera, … Polls the service every 2 s. */
export default function FamilyLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <RequireSession app="family">
        <FamilyShell>{children}</FamilyShell>
      </RequireSession>
    </Suspense>
  );
}
