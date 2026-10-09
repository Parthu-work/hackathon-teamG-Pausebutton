import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { TodoScreen } from "@/screens/rao/evidence";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <TodoScreen />
      </Fresh>
    </Suspense>
  );
}
