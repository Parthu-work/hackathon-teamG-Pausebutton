import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { MonthScreen } from "@/screens/family/phase2";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <MonthScreen />
      </Fresh>
    </Suspense>
  );
}
