"use client";

import { useRouter } from "next/navigation";
import { Fragment } from "react";

/**
 * Next 16 keeps visited screens alive (React Activity). On a phone that feels
 * wrong: tapping into a screen should start it fresh. Keying on bfcacheId
 * resets the screen on push/replace and still restores it on back/forward.
 */
export function Fresh({ children }: { children: React.ReactNode }) {
  const { bfcacheId } = useRouter();
  return <Fragment key={bfcacheId}>{children}</Fragment>;
}
