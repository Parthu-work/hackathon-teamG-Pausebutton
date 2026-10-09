import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { LanguageScreen } from "@/screens/rao/language";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <LanguageScreen />
      </Fresh>
    </Suspense>
  );
}
