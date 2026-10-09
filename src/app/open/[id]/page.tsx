import { Suspense } from "react";
import { OpenAlertScreen } from "@/screens/family/open";

export default function Page() {
  return (
    <Suspense>
      <OpenAlertScreen />
    </Suspense>
  );
}
