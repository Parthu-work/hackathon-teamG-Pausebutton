"use client";

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

// The Android app (android/, Capacitor) opens this same site in its WebView,
// without an address bar, and adds a native bridge: PauseButtonNative
// (ai.apty.pausebutton.PauseButtonNativePlugin). It connects the phone's
// message watcher, says how the watcher is doing, and asks Android for the
// permissions a web page cannot. In a browser, and while rendering on the
// server, none of it exists: isNativeApp() is false and nativeBridge() null.

export type NativePermission = "granted" | "denied" | "prompt";

/** Android's notification permission for the app. canAskAgain is false once the person chose "Don't allow" for good. */
export type NotificationStatus = { permission: NativePermission; canAskAgain: boolean };

export type WatcherStatus = {
  /** This phone has its watcher token (it is connected to someone's account). */
  paired: boolean;
  userName: string | null;
  /** The person agreed to what the watcher reads (the app's own consent screen). */
  consented: boolean;
  /** Android's notification access for Pause Button is on. */
  listenerOn: boolean;
  /** The phone will not stop the app to save battery. */
  batteryUnrestricted: boolean;
  /**
   * Android 13+ and installed from a downloaded APK: notification access stays
   * locked ("Restricted setting") until ⋮ › Allow restricted settings on App info.
   * Missing in apps from before it was reported.
   */
  mayBeRestricted?: boolean;
  /** Messages in the phone's outbox, not yet delivered. */
  waiting: number;
  lastError: string | null;
  /** When a message last reached the server (ms since 1970). */
  lastDeliveredAt: number | null;
  /** Why the last message notification stayed on the phone, in plain words (never sender or text), and when. Missing in older apps. */
  lastSkip?: string | null;
  lastSkipAt?: number | null;
  /** What the watcher did today, in counts only. */
  today: string;
};

export type PairResult = { ok: boolean; error?: string; userName?: string };

export interface PauseButtonNativePlugin {
  /** Trades a pairing code (POST /api/me/devices) for this phone's watcher token. */
  pair(options: { code: string; host?: string }): Promise<PairResult>;
  watcherStatus(): Promise<WatcherStatus>;
  /** The app's consent screen first if the person has not agreed yet; then Android's notification access settings. */
  openListenerSettings(): Promise<void>;
  /** The app's App info page (⋮ › Allow restricted settings). Rejects in apps from before it existed. */
  openAppInfo(): Promise<void>;
  /** Android's "allow running in the background" (ignore battery optimisation) prompt for this app. */
  openBatterySettings(): Promise<void>;
  /** "Disconnect this phone": forgets the token here and tells the server. */
  disconnect(): Promise<void>;
  notificationStatus(): Promise<NotificationStatus>;
  /** Android 13+: the system prompt, unless the person chose "Don't allow" for good (then it only reports). */
  requestNotifications(): Promise<NotificationStatus>;
  openNotificationSettings(): Promise<void>;
  /** The build has Firebase (google-services.json), so it can get an FCM token. */
  pushAvailable(): Promise<{ available: boolean }>;
}

/** Inside the Android app (not a browser, not the server). */
export function isNativeApp(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

let plugin: PauseButtonNativePlugin | null = null;

/** The native bridge, or null outside the Android app. */
export function nativeBridge(): PauseButtonNativePlugin | null {
  if (!isNativeApp()) return null;
  plugin ??= registerPlugin<PauseButtonNativePlugin>("PauseButtonNative");
  return plugin;
}

/**
 * Calls `fn` each time the app comes back to the front (say, after Android's
 * settings, where the person may have changed a permission). Returns the
 * unsubscribe. Outside the app it does nothing.
 */
export function onAppResume(fn: () => void): () => void {
  if (!isNativeApp()) return () => {};
  let handle: PluginListenerHandle | null = null;
  let stopped = false;
  void import("@capacitor/app")
    .then(({ App }) => App.addListener("resume", fn))
    .then((h) => {
      handle = h;
      if (stopped) void h.remove();
    })
    .catch(() => {});
  return () => {
    stopped = true;
    void handle?.remove();
  };
}
