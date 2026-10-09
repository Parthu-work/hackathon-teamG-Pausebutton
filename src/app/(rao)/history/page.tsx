import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { HistoryScreen } from "@/screens/rao/history";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <HistoryScreen />
      </Fresh>
    </Suspense>
  );
}
