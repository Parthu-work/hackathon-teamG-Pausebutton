import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { WhyScreen } from "@/screens/rao/evidence";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <WhyScreen />
      </Fresh>
    </Suspense>
  );
}
