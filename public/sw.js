// Pause Button service worker: shows alerts that arrive while the app is closed,
// in the background, or the phone is locked, and opens the right screen on tap.
// It does not cache pages, so updates reach phones immediately.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Operator pages and sign-in screens are never "the app" a notification is for. */
function appOf(pathname) {
  if (pathname.startsWith("/family")) return "family";
  if (/^\/(demo|tests|welcome|sign-in|role|open|api)(\/|$)/.test(pathname)) return null;
  return "rao";
}

async function windows() {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  // Demo-panel phones are frames inside one page: only real windows count.
  return list.filter((c) => !c.frameType || c.frameType === "top-level");
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Pause Button", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      // The app is on screen: it already rings and opens the alert itself (it
      // polls every 2 s), so a system notification would be a duplicate. Tell
      // it to refresh now instead.
      const app = data.app || "family";
      const onScreen = (await windows()).filter((c) => c.visibilityState === "visible" && appOf(new URL(c.url).pathname) === app);
      if (onScreen.length) {
        onScreen.forEach((c) => c.postMessage({ type: "pb-push", tag: data.tag || null }));
        return;
      }
      const urgent = !!data.urgent;
      await self.registration.showNotification(data.title || "Pause Button", {
        body: data.body || "",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: data.tag || "pause-button",
        renotify: true,
        requireInteraction: urgent,
        vibrate: urgent ? [400, 150, 400, 150, 400, 150, 800] : [150, 80, 150],
        timestamp: Date.now(),
        data: { url: data.url || (app === "rao" ? "/" : "/family") },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/family", self.location.origin);
  // Only our own pages: a notification never opens another site.
  const target = url.origin === self.location.origin ? url.href : new URL("/family", self.location.origin).href;
  event.waitUntil(
    (async () => {
      // Reuse an open window of the app (the "focused" one first), else start the app.
      // A window this worker does not control cannot be navigated: open a new one then.
      const list = (await windows()).filter((c) => appOf(new URL(c.url).pathname) !== null || new URL(c.url).pathname === "/welcome");
      list.sort((a, b) => Number(b.focused) - Number(a.focused));
      for (const client of list) {
        try {
          const navigated = "navigate" in client ? await client.navigate(target) : null;
          if (navigated) return navigated.focus();
        } catch {
          /* not controlled by this worker: try the next window */
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});

// The browser can replace a push subscription (expiry, key rotation). Register
// the new one at once, so alerts keep arriving without the app being opened.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      let sub = event.newSubscription;
      if (!sub) {
        const res = await fetch("/api/push/key", { credentials: "same-origin" });
        const { publicKey } = await res.json();
        if (!publicKey) return;
        sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
      }
      await fetch("/api/push/subscribe", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), oldEndpoint: event.oldSubscription ? event.oldSubscription.endpoint : undefined }),
      });
    })(),
  );
});
