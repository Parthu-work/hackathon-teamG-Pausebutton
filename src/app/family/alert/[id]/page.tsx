import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { AlertScreen } from "@/screens/family/screens";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <AlertScreen />
      </Fresh>
    </Suspense>
  );
}
