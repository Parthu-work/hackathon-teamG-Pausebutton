import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { FamilyCheckScreen } from "@/screens/family/screens";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <FamilyCheckScreen />
      </Fresh>
    </Suspense>
  );
}
