import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { WelcomeScreen } from "@/screens/auth";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <WelcomeScreen />
      </Fresh>
    </Suspense>
  );
}
