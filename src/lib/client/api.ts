"use client";

// Small fetch wrapper used by every screen. The demo panel (/demo) can
// simulate a Wi-Fi drop: while it lasts every call fails like a real
// network error, so the screens show their "Reconnecting…" states.

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const CHANNEL = "pause-button-demo";
let offlineUntil = 0;

if (typeof window !== "undefined" && "BroadcastChannel" in window) {
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e) => {
    if (e.data?.type === "wifi-drop") offlineUntil = Date.now() + (e.data.ms ?? 8000);
  };
}

/** Called by the demo panel; reaches every tab and iframe of this site. */
export function broadcastWifiDrop(ms = 8000) {
  offlineUntil = Date.now() + ms;
  new BroadcastChannel(CHANNEL).postMessage({ type: "wifi-drop", ms });
}

export function isSimulatedOffline() {
  return Date.now() < offlineUntil;
}

export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  if (isSimulatedOffline()) throw new ApiError(0, "We could not reach the check service.");
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
      headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "We could not reach the check service.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "Something went wrong.");
  return data as T;
}

export const post = <T = unknown>(path: string, body: unknown = {}) => api<T>(path, { method: "POST", body });
