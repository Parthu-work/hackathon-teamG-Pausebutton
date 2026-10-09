import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { JoinScreen } from "@/screens/family/screens";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <JoinScreen />
      </Fresh>
    </Suspense>
  );
}
