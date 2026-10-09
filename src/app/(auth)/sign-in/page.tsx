import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { SignInScreen } from "@/screens/auth";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <SignInScreen />
      </Fresh>
    </Suspense>
  );
}
