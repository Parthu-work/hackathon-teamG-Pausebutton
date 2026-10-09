"use client";

import { api, post } from "./api";

// Alerts while the app is closed: the phone registers a service worker and a
// Web Push subscription, which the server uses when an alert is created.
// Android Chrome: works from the browser (and inside the Android app, which
// opens the site in Chrome). iPhone: only once the app is installed to the
// home screen (iOS 16.4+).
//
// One subscription per browser. It is re-sent to the server on every app
// start, so the phone always belongs to the person who is signed in, and it
// is replaced when the server's key changed. Sign-out forgets it.

export type PushApp = "rao" | "family";
export type PushStatus = "subscribed" | "denied" | "unsupported" | "needs-install" | "off" | "error";
export type PushPermission = "granted" | "denied" | "default" | "unsupported" | "needs-install";

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

/** What this phone can do right now: the settings and the home screen hint read this. */
export function pushPermission(): PushPermission {
  if (typeof window === "undefined") return "unsupported";
  if (!pushSupported()) return needsInstall() ? "needs-install" : "unsupported";
  return Notification.permission;
}

export async function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    // updateViaCache "none": a new sw.js reaches phones on the next start, not after the HTTP cache expires.
    return await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  } catch (error) {
    console.warn("[push] service worker:", error);
    return null;
  }
}

/** The VAPID public key as bytes, to compare with the key an existing subscription was made with. */
function keyBytes(base64url: string): Uint8Array {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(have: ArrayBuffer | null | undefined, want: Uint8Array) {
  if (!have) return false;
  const a = new Uint8Array(have);
  if (a.length !== want.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== want[i]) return false;
  return true;
}

/**
 * This phone's subscription for the server's current key. One made with an
 * older key (the keys were rotated) is dropped and replaced; the server is
 * told the old endpoint so it forgets it.
 */
async function ensureSubscription(reg: ServiceWorkerRegistration, publicKey: string) {
  const existing = await reg.pushManager.getSubscription();
  if (existing && sameKey(existing.options.applicationServerKey, keyBytes(publicKey))) return { sub: existing, previousEndpoint: null as string | null };
  if (existing) await existing.unsubscribe().catch(() => {});
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
  return { sub, previousEndpoint: existing?.endpoint ?? null };
}

function register(app: PushApp, sub: PushSubscription, previousEndpoint: string | null) {
  return post("/api/push/subscribe", { subscription: sub.toJSON(), previousEndpoint, app });
}

/**
 * The demo panel shows several phones as frames in one browser, and they share
 * that browser's one push subscription. Only a real (top-level) window
 * registers it; otherwise every frame's start would move the subscription to
 * its own persona (Papa, Arjun, Meera) in turn.
 */
export function inFrame() {
  if (typeof window === "undefined") return false;
  try {
    return window.top !== window.self;
  } catch {
    return true; // a cross-origin parent: certainly a frame
  }
}

/** Asks for permission (must follow a tap) and registers this phone with the server for the signed-in person. */
export async function subscribeToPush(app: PushApp): Promise<PushStatus> {
  if (!pushSupported()) return needsInstall() ? "needs-install" : "unsupported";
  if (inFrame()) return "unsupported";
  const { publicKey } = await api<{ publicKey: string | null }>("/api/push/key");
  if (!publicKey) return "off";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const reg = await registerServiceWorker();
  if (!reg) return "error";
  try {
    const { sub, previousEndpoint } = await ensureSubscription(reg, publicKey);
    await register(app, sub, previousEndpoint);
    return "subscribed";
  } catch (error) {
    console.warn("[push] subscribe:", error);
    return "error";
  }
}

/** "Notifications" off: the server forgets this phone for this person, then the phone drops the subscription. */
export async function unsubscribeFromPush(app: PushApp) {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api("/api/push/subscribe", { method: "DELETE", body: { endpoint: sub.endpoint, app } }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/**
 * On every app start, when permission was already given: make sure this phone
 * is registered for the person who is signed in now (endpoints change, keys
 * rotate, another person may have signed out on this phone). Never prompts.
 */
export async function resyncPush(app: PushApp) {
  if (!pushSupported() || Notification.permission !== "granted" || inFrame()) return;
  try {
    const reg = await registerServiceWorker();
    if (!reg) return;
    const { publicKey } = await api<{ publicKey: string | null }>("/api/push/key");
    if (!publicKey) return;
    const { sub, previousEndpoint } = await ensureSubscription(reg, publicKey);
    await register(app, sub, previousEndpoint);
  } catch (error) {
    console.warn("[push] resync:", error);
  }
}

/** This phone's push endpoint, so sign-out can tell the server which phone to forget. */
export async function currentPushEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return sub?.endpoint ?? null;
  } catch {
    return null;
  }
}

/** Drops the phone's subscription (after sign-out). The next sign-in makes a fresh one without asking again. */
export async function dropPushSubscription() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch {
    /* nothing to drop */
  }
}

/** Closes the system notifications whose tag matches: an alert that was opened or handled in the app needs no reminder. */
export async function closeNotifications(match: (tag: string) => boolean) {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const open = (await reg?.getNotifications()) ?? [];
    for (const n of open) if (match(n.tag)) n.close();
  } catch {
    /* no service worker here */
  }
}

/** What the settings screen says under the Notifications toggle. */
export function pushStatusText(): string {
  if (!pushSupported()) return needsInstall() ? "Install the app on your home screen to get alerts when it is closed." : "This browser cannot show alerts when the app is closed.";
  if (Notification.permission === "granted") return "Alerts reach this phone even when the app is closed.";
  if (Notification.permission === "denied") return "Alerts are blocked in your phone's settings for this site.";
  return "Turn on Notifications so alerts reach you when the app is closed.";
}
