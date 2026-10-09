import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { CampaignsPage } from "@/screens/operator-phase2";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <CampaignsPage />
      </Fresh>
    </Suspense>
  );
}
