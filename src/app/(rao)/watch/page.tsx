import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { WatchScreen } from "@/screens/rao/watch";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <WatchScreen />
      </Fresh>
    </Suspense>
  );
}
