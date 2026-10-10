"use client";

import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { Sheet } from "@/components/ui";
import { nativeBridge } from "@/lib/client/native";
import { nativeNotificationStatus, subscribePushPermission, subscribeToPush, type PushApp, type PushStatus } from "@/lib/client/push";

// Notifications in the Android app (D1). Android asks for the permission at
// most twice, and a "Don't allow" is hard to undo, so the app first says why
// it asks (Continue / Not now) and only then shows Android's prompt. When
// notifications are off for the app, a banner says so and opens Android's
// settings for it; Android's prompt is never shown again after "Don't allow".
// In a browser none of this shows and asking goes straight to the browser.

export type NotificationsCopy = {
  /** Why we ask: "So your family's alerts reach you". */
  why: string;
  whySub: string;
  continue: string;
  notNow: string;
  /** "Notifications are off for Pause Button" */
  off: string;
  offSub: string;
  /** "Turn on in Settings": opens Android's notification settings for the app. */
  openSettings: string;
};

type Ctx = {
  app: PushApp;
  copy: NotificationsCopy;
  /** The person wants alerts on this phone (their Notifications setting in the app). */
  wanted: boolean;
  ask: () => Promise<PushStatus | null>;
};

const NotificationsContext = createContext<Ctx | null>(null);

// "Not now" holds until the app is next opened: no asking again on every screen.
const NOT_NOW_KEY = "pb-notifications-not-now";
let notNowHere = false;
const saidNotNow = () => {
  if (notNowHere) return true;
  try {
    return sessionStorage.getItem(NOT_NOW_KEY) === "1";
  } catch {
    return false;
  }
};
const noStorage = () => false;
let notNowListeners: (() => void)[] = [];
function sayNotNow() {
  notNowHere = true;
  try {
    sessionStorage.setItem(NOT_NOW_KEY, "1");
  } catch {
    /* remembered until the page reloads */
  }
  for (const fn of notNowListeners) fn();
}
function subscribeNotNow(fn: () => void) {
  notNowListeners.push(fn);
  return () => {
    notNowListeners = notNowListeners.filter((f) => f !== fn);
  };
}

/**
 * Around a phone app's screens, inside its phone frame (Mr Rao's or the
 * family's): what the explanation says, and whether the person wants alerts.
 * The explanation itself shows here, as a sheet over the screen.
 */
export function NativeNotificationsProvider({ app, copy, wanted, children }: { app: PushApp; copy: NotificationsCopy; wanted: boolean; children: React.ReactNode }) {
  const [waiting, setWaiting] = useState<((go: boolean) => void) | null>(null);

  // A tap on "Notifications" or "Turn on notifications". In the Android app,
  // when Android would show its prompt, the explanation comes first; "Not now"
  // answers null and nothing is asked. In a browser: the browser's own prompt.
  const ask = useCallback(async (): Promise<PushStatus | null> => {
    const bridge = nativeBridge();
    if (bridge) {
      const status = await bridge.notificationStatus().catch(() => null);
      const willPrompt = !!status && status.permission !== "granted" && (status.permission === "prompt" || status.canAskAgain);
      if (willPrompt) {
        const go = await new Promise<boolean>((resolve) => setWaiting(() => resolve));
        setWaiting(null);
        if (!go) {
          sayNotNow();
          return null;
        }
      }
    }
    return subscribeToPush(app);
  }, [app]);

  const value = useMemo<Ctx>(() => ({ app, copy, wanted, ask }), [app, copy, wanted, ask]);
  return (
    <NotificationsContext.Provider value={value}>
      {children}
      {waiting && (
        <Sheet onClose={() => waiting(false)}>
          <span className="circle" style={{ width: 56, height: 56, background: "#F2A900", color: "#14202B", alignSelf: "center" }}><Icon name="bell" size={30} /></span>
          <h2 className="h2 center-text">{copy.why}</h2>
          <p className="p">{copy.whySub}</p>
          <button className="btn amber" onClick={() => waiting(true)} data-testid="notifications-continue">{copy.continue}</button>
          <button className="btn line" onClick={() => waiting(false)}>{copy.notNow}</button>
        </Sheet>
      )}
    </NotificationsContext.Provider>
  );
}

/** The ask for screens: explanation first in the Android app (null when the person said "Not now"). */
export function useAskNotifications(app: PushApp): () => Promise<PushStatus | null> {
  const ctx = useContext(NotificationsContext);
  return ctx?.ask ?? (() => subscribeToPush(app));
}

const noStatus = () => null;

/**
 * Inside the Android app only, while the person wants alerts but Android
 * would not show them: before the first ask, the explanation with Continue
 * (Android's prompt) and Not now; once notifications are off for the app,
 * "Notifications are off for Pause Button" and the way to Android's settings.
 * In a browser, and once allowed, it renders nothing.
 */
export function NativeNotificationsBanner() {
  const ctx = useContext(NotificationsContext);
  const status = useSyncExternalStore(subscribePushPermission, nativeNotificationStatus, noStatus);
  const notNow = useSyncExternalStore(subscribeNotNow, saidNotNow, noStorage);
  if (!ctx || !ctx.wanted || !status || status.permission === "granted") return null;
  const { copy, app } = ctx;

  if (status.permission === "denied") {
    return (
      <div className="card tint-red" style={{ gap: 8 }} role="status" data-testid="native-notifications-off">
        <div className="row"><Icon name="bell" /><b className="grow" style={{ fontSize: 16 }}>{copy.off}</b></div>
        <p className="sm" style={{ color: "var(--text)" }}>{copy.offSub}</p>
        <button className="btn line sm-btn" onClick={() => void nativeBridge()?.openNotificationSettings()}>{copy.openSettings}</button>
      </div>
    );
  }
  if (notNow) return null;
  // The explanation is on screen, so Continue goes straight to Android's prompt.
  return (
    <div className="card tint-amber" style={{ gap: 8 }} data-testid="native-notifications-ask">
      <div className="row"><Icon name="bell" /><b className="grow" style={{ fontSize: 16 }}>{copy.why}</b></div>
      <p className="sm" style={{ color: "var(--text)" }}>{copy.whySub}</p>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn amber sm-btn" onClick={() => void subscribeToPush(app)}>{copy.continue}</button>
        <button className="btn line sm-btn" onClick={sayNotNow}>{copy.notNow}</button>
      </div>
    </div>
  );
}
