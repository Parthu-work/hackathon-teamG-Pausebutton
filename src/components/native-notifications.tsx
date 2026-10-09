"use client";

/**
 * Inside the Android app only: when notifications are blocked for the app, a
 * banner that says so and opens the phone's settings for it. On the web (and
 * while permission is granted or not yet asked) it renders nothing.
 * The Capacitor bridge fills this in; until then it is a no-op.
 */
export function NativeNotificationsBanner({ app }: { app: "rao" | "family" }) {
  void app;
  return null;
}
