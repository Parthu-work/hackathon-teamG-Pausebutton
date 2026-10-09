import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { ActivityScreen } from "@/screens/family/screens";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <ActivityScreen />
      </Fresh>
    </Suspense>
  );
}
