import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { ReportsPage } from "@/screens/operator-phase2";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <ReportsPage />
      </Fresh>
    </Suspense>
  );
}
