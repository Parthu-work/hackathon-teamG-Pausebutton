import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { InvitesScreen } from "@/screens/rao/people";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <InvitesScreen />
      </Fresh>
    </Suspense>
  );
}
