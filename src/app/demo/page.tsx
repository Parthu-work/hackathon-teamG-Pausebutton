import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { DemoPage } from "@/screens/operator";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <DemoPage />
      </Fresh>
    </Suspense>
  );
}
