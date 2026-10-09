import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { PersonFormScreen } from "@/screens/rao/people";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <PersonFormScreen />
      </Fresh>
    </Suspense>
  );
}
