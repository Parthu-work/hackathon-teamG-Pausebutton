import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { CallVerdictScreen } from "@/screens/rao/call";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <CallVerdictScreen />
      </Fresh>
    </Suspense>
  );
}
