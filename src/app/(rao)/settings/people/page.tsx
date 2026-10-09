import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { ManagePeopleScreen } from "@/screens/rao/people";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <ManagePeopleScreen />
      </Fresh>
    </Suspense>
  );
}
