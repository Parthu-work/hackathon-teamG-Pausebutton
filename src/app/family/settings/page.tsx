import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { FamilySettingsScreen } from "@/screens/family/screens";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <FamilySettingsScreen />
      </Fresh>
    </Suspense>
  );
}
