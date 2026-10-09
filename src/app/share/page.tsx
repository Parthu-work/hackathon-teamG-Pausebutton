import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { ShareScreen } from "@/screens/rao/share";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <ShareScreen />
      </Fresh>
    </Suspense>
  );
}
