import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { ReportLinkScreen } from "@/screens/family/phase2";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <ReportLinkScreen />
      </Fresh>
    </Suspense>
  );
}
