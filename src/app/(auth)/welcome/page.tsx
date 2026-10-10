import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { RedirectIfSignedIn } from "@/components/redirect-if-signed-in";
import { WelcomeScreen } from "@/screens/auth";

export default function Page() {
  return (
    <Suspense>
      <RedirectIfSignedIn>
        <Fresh>
          <WelcomeScreen />
        </Fresh>
      </RedirectIfSignedIn>
    </Suspense>
  );
}
