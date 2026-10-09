import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { SpeakScreen } from "@/screens/rao/speak";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <SpeakScreen />
      </Fresh>
    </Suspense>
  );
}
