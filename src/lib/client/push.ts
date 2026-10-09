"use client";

import { api, post } from "./api";

// Alerts while the app is closed: the phone registers a service worker and a
// Web Push subscription, which the server uses when an alert is created.
// Android Chrome: works from the browser. iPhone: only once the app is
// installed to the home screen (iOS 16.4+).

export type PushStatus = "subscribed" | "denied" | "unsupported" | "needs-install" | "off" | "error";

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** iPhone Safari only allows push for an installed (home-screen) app. */
export function needsInstall() {
  if (typeof window === "undefined") return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

export async function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch (error) {
    console.warn("[push] service worker:", error);
    return null;
  }
}

/** Asks for permission (must follow a tap) and registers this phone with the server. */
export async function subscribeToPush(): Promise<PushStatus> {
  if (!pushSupported()) return needsInstall() ? "needs-install" : "unsupported";
  const { publicKey } = await api<{ publicKey: string | null }>("/api/push/key");
  if (!publicKey) return "off";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const reg = await registerServiceWorker();
  if (!reg) return "error";
  try {
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey }));
    await post("/api/push/subscribe", { subscription: sub.toJSON() });
    return "subscribed";
  } catch (error) {
    console.warn("[push] subscribe:", error);
    return "error";
  }
}

export async function unsubscribeFromPush() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api("/api/push/subscribe", { method: "DELETE", body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/** Keeps the server's copy fresh when permission was already given (endpoints can change). */
export async function resyncPush() {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const reg = await registerServiceWorker();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await post("/api/push/subscribe", { subscription: sub.toJSON() }).catch(() => {});
}

/** What the settings screen says under the Notifications toggle. */
export function pushStatusText(): string {
  if (!pushSupported()) return needsInstall() ? "Install the app on your home screen to get alerts when it is closed." : "This browser cannot show alerts when the app is closed.";
  if (Notification.permission === "granted") return "Alerts reach this phone even when the app is closed.";
  if (Notification.permission === "denied") return "Alerts are blocked in your phone's settings for this site.";
  return "Turn on Notifications so alerts reach you when the app is closed.";
}
