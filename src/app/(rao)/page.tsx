import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { HomeScreen } from "@/screens/rao/home";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <HomeScreen />
      </Fresh>
    </Suspense>
  );
}
