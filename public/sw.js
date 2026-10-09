// Pause Button service worker: shows alerts that arrive while the app is closed.
// It does not cache pages, so updates reach phones immediately.
//
// F2 · Lock-screen alerts with Block built in: an urgent alert about a paused
// payment carries two buttons. "Block payment" blocks it from the lock screen
// (no unlock, no app) and shows "You blocked it". "It's fine" opens the app on
// the approve step, because approving a payment always needs a second confirm.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Pause Button", body: event.data ? event.data.text() : "" };
  }
  const urgent = !!data.urgent;
  event.waitUntil(
    self.registration.showNotification(data.title || "Pause Button", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "pause-button",
      renotify: true,
      requireInteraction: urgent,
      vibrate: urgent ? [400, 150, 400, 150, 400, 150, 800] : [150, 80, 150],
      actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
      data: { url: data.url || "/family", holdId: data.holdId || null, who: data.who || "" },
    }),
  );
});

function openApp(url) {
  const target = new URL(url, self.location.origin).href;
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => "focus" in c);
    if (open) {
      if ("navigate" in open) open.navigate(target).catch(() => {});
      return open.focus();
    }
    return self.clients.openWindow(target);
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
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: `hold-${holdId}`,
        actions: [{ action: "open", title: ok ? `Call ${name}` : "Open" }],
        data: { url: `/family/hold/${holdId}${ok ? "?call=1" : ""}` },
      }),
    )
    .catch(() =>
      self.registration.showNotification("Could not reach Pause Button", {
        body: "Open the app to block the payment. The money stays paused meanwhile.",
        icon: "/icon-192.png",
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
