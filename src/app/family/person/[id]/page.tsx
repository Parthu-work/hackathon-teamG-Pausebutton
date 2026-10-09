import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { PersonScreen } from "@/screens/family/screens";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <PersonScreen />
      </Fresh>
    </Suspense>
  );
}
