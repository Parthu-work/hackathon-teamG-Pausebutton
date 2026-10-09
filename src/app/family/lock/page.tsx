import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { LockScreen } from "@/screens/family/phase2";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <LockScreen />
      </Fresh>
    </Suspense>
  );
}
