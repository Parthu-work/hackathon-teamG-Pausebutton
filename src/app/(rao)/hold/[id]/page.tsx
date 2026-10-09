import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { HoldScreen } from "@/screens/rao/hold";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <HoldScreen />
      </Fresh>
    </Suspense>
  );
}
