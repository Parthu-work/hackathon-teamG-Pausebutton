import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { SettingsScreen } from "@/screens/rao/history";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <SettingsScreen />
      </Fresh>
    </Suspense>
  );
}
