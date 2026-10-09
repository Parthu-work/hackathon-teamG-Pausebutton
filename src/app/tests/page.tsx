import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { TestsPage } from "@/screens/operator";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <TestsPage />
      </Fresh>
    </Suspense>
  );
}
