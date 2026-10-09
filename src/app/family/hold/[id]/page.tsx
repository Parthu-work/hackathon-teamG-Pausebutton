import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { FamilyHoldScreen } from "@/screens/family/screens";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <FamilyHoldScreen />
      </Fresh>
    </Suspense>
  );
}
