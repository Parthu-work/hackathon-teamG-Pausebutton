import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { SetupPeopleScreen } from "@/screens/rao/people";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <SetupPeopleScreen />
      </Fresh>
    </Suspense>
  );
}
