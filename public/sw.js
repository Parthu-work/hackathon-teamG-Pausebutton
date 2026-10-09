// Pause Button service worker: shows alerts that arrive while the app is closed.
// It does not cache pages, so updates reach phones immediately.
//
// F2 · Lock-screen alerts with Block built in: an urgent alert about a paused
// payment carries two buttons. "Block payment" blocks it from the lock screen
// (no unlock, no app) and shows "You blocked it". "It's fine" opens the app on
// the approve step, because approving a payment always needs a second confirm.
//
// A tap on any other notification opens the app straight on the screen the
// notification is about (/open/<alertId> for a family alert, which resolves to
// the paused payment or the message; /check/<id> or /hold/<id> on Mr Rao's
// phone), in the window that already shows the app when there is one.
//
// Receipts: once a notification is on screen (or could not be shown), the
// worker tells the server, so a push that never reaches anyone is noticed.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const ICON = "/icon-192.png";
const OPERATOR_PAGES = /^\/(demo|tests|campaigns|reports)(\/|$)/;

function parse(event) {
  try {
    return event.data ? event.data.json() : {};
  } catch {
    return { title: "Pause Button", body: event.data ? event.data.text() : "" };
  }
}

async function showAlert(data) {
  const urgent = !!data.urgent;
  const tag = data.tag || "pause-button";
  // A newer notification about the same message replaces the older one in the
  // tray (a quiet heads-up, then the urgent alert when Papa forwards it).
  if (data.checkId) {
    const open = await self.registration.getNotifications();
    for (const n of open) {
      if (n.tag !== tag && n.data && n.data.checkId === data.checkId) n.close();
    }
  }
  const at = data.at ? Date.parse(data.at) : NaN;
  const options = {
    body: data.body || "",
    icon: ICON,
    badge: ICON,
    tag,
    renotify: true,
    requireInteraction: urgent,
    vibrate: urgent ? [400, 150, 400, 150, 400, 150, 800] : [150, 80, 150],
    actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
    data: {
      url: data.url || "/family",
      holdId: data.holdId || null,
      who: data.who || "",
      alertId: data.alertId || null,
      checkId: data.checkId || null,
      kind: data.kind || null,
    },
  };
  if (!Number.isNaN(at)) options.timestamp = at;
  return self.registration.showNotification(data.title || "Pause Button", options);
}

/** Tells the server this phone got the push, and whether it could show it. Never fails the push. */
function receipt(data, shown, error) {
  if (!data.receipt) return Promise.resolve();
  return fetch("/api/push/receipt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: data.receipt, shown, error: error ? String(error.name || error).slice(0, 80) : null }),
  }).catch(() => {});
}

self.addEventListener("push", (event) => {
  const data = parse(event);
  event.waitUntil(
    showAlert(data).then(
      () => receipt(data, true),
      (error) => receipt(data, false, error),
    ),
  );
});

/**
 * Opens the app on `url`. The window that already shows this part of the app
 * (a family phone for a family alert) is focused and navigated; the operator
 * pages are never used; with no window open, a new one opens straight on the
 * page, so a closed app initialises on the right screen.
 */
function openApp(url) {
  const target = new URL(url, self.location.origin).href;
  const section = new URL(target).pathname.split("/")[1] || "";
  const wantsFamily = section === "family" || section === "open";
  const isFamily = (pathname) => pathname.startsWith("/family") || pathname.startsWith("/open");
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const windows = list.filter((c) => "focus" in c && !OPERATOR_PAGES.test(new URL(c.url).pathname));
    const client = windows.find((c) => isFamily(new URL(c.url).pathname) === wantsFamily) || windows[0];
    if (!client) return self.clients.openWindow(target);
    return client
      .focus()
      .then((focused) => {
        const w = focused || client;
        return "navigate" in w ? w.navigate(target) : w;
      })
      .catch(() => self.clients.openWindow(target));
  });
}

/** Blocks the paused payment straight from the notification, then says so. */
function blockFromLockScreen(holdId, who) {
  const name = who || "Papa";
  return fetch(`/api/family/holds/${holdId}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ decision: "block", confirm: false }),
  })
    .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
    .then(({ ok, json }) =>
      self.registration.showNotification(ok ? "You blocked it" : "Could not block it", {
        body: ok
          ? `${name}'s phone now shows “Payment cancelled”. Nothing left the account.`
          : (json && json.error) || "Open Pause Button to block the payment.",
        icon: ICON,
        badge: ICON,
        tag: `hold-${holdId}`,
        actions: [{ action: "open", title: ok ? `Call ${name}` : "Open" }],
        data: { url: `/family/hold/${holdId}${ok ? "?call=1" : ""}` },
      }),
    )
    .catch(() =>
      self.registration.showNotification("Could not reach Pause Button", {
        body: "Open the app to block the payment. The money stays paused meanwhile.",
        icon: ICON,
        tag: `hold-${holdId}`,
        data: { url: `/family/hold/${holdId}` },
      }),
    );
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || "/family";
  if (event.action === "block" && data.holdId) {
    event.waitUntil(blockFromLockScreen(data.holdId, data.who));
    return;
  }
  if (event.action === "fine" && data.holdId) {
    event.waitUntil(openApp(`/family/hold/${data.holdId}?approve=1`));
    return;
  }
  event.waitUntil(openApp(url));
});

// The push service replaced this phone's subscription (it expired or was
// rotated): subscribe again with the same key and tell the server, which
// forgets the old endpoint. The session cookie goes along with the request.
self.addEventListener("pushsubscriptionchange", (event) => {
  const old = event.oldSubscription || null;
  const knownKey = old && old.options ? old.options.applicationServerKey : null;
  const key = knownKey
    ? Promise.resolve(knownKey)
    : fetch("/api/push/key", { credentials: "same-origin" })
        .then((r) => r.json())
        .then((j) => j.publicKey || null);
  event.waitUntil(
    key
      .then((k) => (k ? self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: k }) : null))
      .then((sub) =>
        sub
          ? fetch("/api/push/subscribe", {
              method: "POST",
              headers: { "content-type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({ subscription: sub.toJSON(), previousEndpoint: old ? old.endpoint : null }),
            })
          : null,
      )
      .catch(() => {}),
  );
});
