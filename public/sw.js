// Pause Button service worker: shows alerts that arrive while the app is closed.
// It does not cache pages, so updates reach phones immediately.

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
      data: { url: data.url || "/family" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/family", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => "focus" in c);
      if (open) {
        if ("navigate" in open) open.navigate(url).catch(() => {});
        return open.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
