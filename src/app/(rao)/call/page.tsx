import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { CallScreen } from "@/screens/rao/call";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <CallScreen />
      </Fresh>
    </Suspense>
  );
}
