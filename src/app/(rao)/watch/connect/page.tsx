import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { ConnectScreen } from "@/screens/rao/watch";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <ConnectScreen />
      </Fresh>
    </Suspense>
  );
}
