import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { PayScreen } from "@/screens/rao/evidence";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <PayScreen />
      </Fresh>
    </Suspense>
  );
}
