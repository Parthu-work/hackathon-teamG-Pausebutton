import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { InboxScreen } from "@/screens/rao/inbox";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <InboxScreen />
      </Fresh>
    </Suspense>
  );
}
