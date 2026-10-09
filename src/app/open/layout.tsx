import { Suspense } from "react";
import { PhoneFrame } from "@/components/ui";

/**
 * /open/<alertId> is where a tap on a push notification lands. It is outside
 * the family shell and its server-side sign-in check on purpose: a signed-out
 * phone must keep the destination through the welcome and sign-in screens.
 */
export default function OpenLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <PhoneFrame>{children}</PhoneFrame>
    </Suspense>
  );
}
