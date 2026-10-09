import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { StopScreen } from "@/screens/rao/verdict";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <StopScreen />
      </Fresh>
    </Suspense>
  );
}
