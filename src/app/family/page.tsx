import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { FamilyHomeScreen } from "@/screens/family/screens";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <FamilyHomeScreen />
      </Fresh>
    </Suspense>
  );
}
