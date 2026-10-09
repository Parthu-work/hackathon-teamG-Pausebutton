import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { AlertsSetupScreen } from "@/screens/family/screens";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <AlertsSetupScreen />
      </Fresh>
    </Suspense>
  );
}
