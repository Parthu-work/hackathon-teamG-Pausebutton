import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { LinkScreen } from "@/screens/rao/evidence";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <LinkScreen />
      </Fresh>
    </Suspense>
  );
}
