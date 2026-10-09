import { Suspense } from "react";
import { Fresh } from "@/components/fresh";
import { RoleScreen } from "@/screens/auth";

export default function Page() {
  return (
    <Suspense>
      <Fresh>
        <RoleScreen />
      </Fresh>
    </Suspense>
  );
}
