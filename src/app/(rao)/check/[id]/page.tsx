import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { VerdictScreen } from "@/screens/rao/verdict";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <VerdictScreen />
      </Fresh>
    </Suspense>
  );
}
