"use client";

// A notification tapped on a signed-out phone: /open/<alertId> stashes where it
// wanted to go, the sign-in flow runs, and the family shell picks the
// destination up. sessionStorage: it lives in this tab only, like a forwarded
// message (pending-share.ts).

const KEY = "pb-pending-open";

export function stashPendingOpen(path: string) {
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    /* storage unavailable: the shell opens the newest alert by itself anyway */
  }
}

export function takePendingOpen(): string | null {
  try {
    const path = sessionStorage.getItem(KEY);
    if (!path) return null;
    sessionStorage.removeItem(KEY);
    return path.startsWith("/") && !path.startsWith("//") ? path : null;
  } catch {
    return null;
  }
}
