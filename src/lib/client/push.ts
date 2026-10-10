"use client";

import type { PluginListenerHandle } from "@capacitor/core";
import { api, post } from "./api";
import { isNativeApp, nativeBridge, onAppResume, type NativePermission, type NotificationStatus } from "./native";

// Alerts while the app is closed.
// - In a browser: a service worker and a Web Push subscription, which the
//   server uses when an alert is created. Android Chrome: works from the
//   browser. iPhone: only once the app is installed to the home screen
//   (iOS 16.4+).
// - In the Android app: Android's own notification permission and an FCM
//   token; the app shows the notification itself (no service worker).
//
// One registration per phone. It is re-sent to the server on every app start,
// so the phone always belongs to the person who is signed in, and it is
// replaced when the server's key (or the FCM token) changed. Sign-out forgets it.

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

const FROM_NATIVE: Record<NativePermission, PushPermission> = { granted: "granted", prompt: "default", denied: "denied" };

/** What this phone can do right now: the settings and the home screen hint read this. */
export function pushPermission(): PushPermission {
  if (typeof window === "undefined") return "unsupported";
  if (isNativeApp()) return FROM_NATIVE[nativeStatus?.permission ?? "prompt"];
  if (!pushSupported()) return needsInstall() ? "needs-install" : "unsupported";
  return Notification.permission;
}

export async function registerServiceWorker() {
  // The Android app shows its own notifications: no service worker there.
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || isNativeApp()) return null;
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

/**
 * Asks for permission (must follow a tap) and registers this phone with the
 * server for the signed-in person. In the Android app, show the explanation
 * first (NativeNotificationsProvider's ask does): this one goes straight to
 * Android's prompt.
 */
export async function subscribeToPush(app: PushApp): Promise<PushStatus> {
  if (isNativeApp()) return subscribeNative(app);
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
  if (isNativeApp()) {
    const token = fcmToken();
    if (!token) return;
    await api("/api/push/subscribe", { method: "DELETE", body: { endpoint: fcmEndpoint(token), app } }).catch(() => {});
    await dropFcmToken();
    return;
  }
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
  if (isNativeApp()) {
    resyncApp = app;
    watchNativeStatus();
    const status = await refreshNativeStatus();
    if (status?.permission === "granted") await registerNative(app).catch((error) => console.warn("[push] resync:", error));
    return;
  }
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
  if (isNativeApp()) {
    const token = fcmToken();
    return token ? fcmEndpoint(token) : null;
  }
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
  if (isNativeApp()) return dropFcmToken();
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
  if (isNativeApp()) {
    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const { notifications } = await PushNotifications.getDeliveredNotifications();
      const done = notifications.filter((n) => n.tag && match(n.tag));
      if (done.length) await PushNotifications.removeDeliveredNotifications({ notifications: done });
    } catch {
      /* nothing to close */
    }
    return;
  }
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
  if (isNativeApp()) {
    const permission = pushPermission();
    if (permission === "granted") return "Alerts reach this phone even when the app is closed.";
    if (permission === "denied") return "Notifications are off for Pause Button in your phone's settings.";
    return "Turn on Notifications so alerts reach you when the app is closed.";
  }
  if (!pushSupported()) return needsInstall() ? "Install the app on your home screen to get alerts when it is closed." : "This browser cannot show alerts when the app is closed.";
  if (Notification.permission === "granted") return "Alerts reach this phone even when the app is closed.";
  if (Notification.permission === "denied") return "Alerts are blocked in your phone's settings for this site.";
  return "Turn on Notifications so alerts reach you when the app is closed.";
}

// ---------------- the Android app ----------------
//
// Android decides the permission. It is read when the app starts and each time
// it comes back to the front (the person may have changed it in Android's
// settings), and kept here, so screens read it synchronously, as they read
// Notification.permission in a browser, and re-render when it changes
// (subscribePushPermission, for useSyncExternalStore).

let nativeStatus: NotificationStatus | null = null;
const permissionListeners = new Set<() => void>();
let watching = false;
/** The app that last re-registered this phone, so a permission given in Android's settings registers it at once. */
let resyncApp: PushApp | null = null;

function setNativeStatus(next: NotificationStatus) {
  if (nativeStatus?.permission === next.permission && nativeStatus.canAskAgain === next.canAskAgain) return;
  nativeStatus = { permission: next.permission, canAskAgain: next.canAskAgain };
  for (const fn of permissionListeners) fn();
}

async function refreshNativeStatus(): Promise<NotificationStatus | null> {
  const bridge = nativeBridge();
  if (!bridge) return null;
  try {
    setNativeStatus(await bridge.notificationStatus());
  } catch (error) {
    console.warn("[push] notification status:", error);
  }
  return nativeStatus;
}

function watchNativeStatus() {
  if (watching || !isNativeApp()) return;
  watching = true;
  void refreshNativeStatus();
  onAppResume(() => {
    const before = nativeStatus?.permission;
    void refreshNativeStatus().then((now) => {
      if (before !== "granted" && now?.permission === "granted" && resyncApp) void resyncPush(resyncApp);
    });
  });
}

/** For useSyncExternalStore: re-renders when the Android app's notification permission changes. Nothing to watch in a browser. */
export function subscribePushPermission(onChange: () => void) {
  if (!isNativeApp()) return () => {};
  watchNativeStatus();
  permissionListeners.add(onChange);
  return () => {
    permissionListeners.delete(onChange);
  };
}

/** In the Android app: the notification permission as last read (null before the first read, and in a browser). */
export function nativeNotificationStatus(): NotificationStatus | null {
  return nativeStatus;
}

/** A second tap while Android's prompt is up gets the first tap's answer, not a second prompt. */
let subscribing: Promise<PushStatus> | null = null;

function subscribeNative(app: PushApp): Promise<PushStatus> {
  subscribing ??= askAndRegister(app).finally(() => (subscribing = null));
  return subscribing;
}

async function askAndRegister(app: PushApp): Promise<PushStatus> {
  const bridge = nativeBridge()!;
  try {
    let status = await bridge.notificationStatus();
    // "Don't allow" for good: Android would not ask again, so neither do we (the screens offer its settings).
    if (status.permission === "denied" && !status.canAskAgain) {
      setNativeStatus(status);
      return "denied";
    }
    if (status.permission !== "granted") status = await bridge.requestNotifications();
    setNativeStatus(status);
    if (status.permission !== "granted") return "denied";
    return await registerNative(app);
  } catch (error) {
    console.warn("[push] subscribe:", error);
    return "error";
  }
}

/** Sends this phone's FCM token to the server for the signed-in person. "off" when this build or the server has no FCM. */
async function registerNative(app: PushApp): Promise<PushStatus> {
  const [{ available }, { fcm }] = await Promise.all([nativeBridge()!.pushAvailable(), api<{ fcm?: boolean }>("/api/push/key")]);
  if (!available || !fcm) return "off";
  const token = await askFcmToken();
  await post("/api/push/subscribe", { fcmToken: token, app });
  storeFcmToken(token);
  return "subscribed";
}

const TOKEN_KEY = "pb-fcm-token";
const TOKEN_WAIT_MS = 10_000;
let lastToken: string | null = null;
let asking: Promise<string> | null = null;

const fcmEndpoint = (token: string) => `fcm:${token}`;

/** The FCM token this phone last registered, so sign-out and "Notifications off" can name it. */
function fcmToken(): string | null {
  if (lastToken) return lastToken;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeFcmToken(token: string | null) {
  lastToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* kept in memory only */
  }
}

/** Firebase's token for this phone, through the push plugin: register, then wait for its answer. */
function askFcmToken(): Promise<string> {
  asking ??= (async () => {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const handles: Promise<PluginListenerHandle>[] = [];
    try {
      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no FCM token")), TOKEN_WAIT_MS);
        const settle = (fn: () => void) => {
          clearTimeout(timer);
          fn();
        };
        handles.push(PushNotifications.addListener("registration", (t) => settle(() => resolve(t.value))));
        handles.push(PushNotifications.addListener("registrationError", (e) => settle(() => reject(new Error(e.error)))));
        // Listening first: the answer can come at once.
        Promise.all(handles)
          .then(() => PushNotifications.register())
          .catch((error) => settle(() => reject(error)));
      });
    } finally {
      for (const h of handles) void h.then((x) => x.remove()).catch(() => {});
    }
  })().finally(() => (asking = null));
  return asking;
}

/** Deletes this phone's FCM token (the next registration gets a new one). Only when one was registered: a build without Firebase has none. */
async function dropFcmToken() {
  if (!fcmToken()) return;
  storeFcmToken(null);
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.unregister();
  } catch {
    /* nothing to drop */
  }
}
