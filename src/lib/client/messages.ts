"use client";

// The pasted text stays on this phone (sessionStorage) so "Why we think so"
// can highlight it. The server only keeps the warning phrases.

const key = (checkId: string) => `pb-msg-${checkId}`;

export function saveMessage(checkId: string, text: string) {
  try {
    sessionStorage.setItem(key(checkId), text);
  } catch {
    /* storage unavailable: the evidence screen shows phrases only */
  }
}

export function loadMessage(checkId: string): string | null {
  try {
    return sessionStorage.getItem(key(checkId));
  } catch {
    return null;
  }
}

/** Delete my history or account: the texts kept on this phone go too. */
export function forgetMessages() {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith("pb-msg-")) sessionStorage.removeItem(k);
  } catch {
    /* storage unavailable: nothing was kept */
  }
}
