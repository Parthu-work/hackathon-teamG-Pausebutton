"use client";

// F1 · A forwarded message that arrived before the person was signed in. The
// share screen stashes it here, the sign-in flow runs, and the home screen
// picks it up and checks it. sessionStorage: it lives in this tab only.

const KEY = "pb-pending-share";

export type PendingShare = { text: string; from: string | null };

export function stashPendingShare(share: PendingShare) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(share));
  } catch {
    /* storage unavailable: the person pastes it instead */
  }
}

export function takePendingShare(): PendingShare | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as PendingShare;
    return parsed && typeof parsed.text === "string" && parsed.text.trim() ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingShare() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
