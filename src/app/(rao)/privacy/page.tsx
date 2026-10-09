import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { PrivacyScreen } from "@/screens/rao/history";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <PrivacyScreen />
      </Fresh>
    </Suspense>
  );
}
