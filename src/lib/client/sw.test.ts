import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

// public/sw.js in a sandbox: what a push shows, what a tap opens, the
// lock-screen Block, and what happens when the push service replaces the
// subscription. The browser's service-worker globals are stubbed just enough.

type Listener = (event: Record<string, unknown>) => void;
type Shown = { title: string; options: Record<string, unknown> & { tag: string; data: Record<string, unknown> } };
type Tray = { tag: string; data: Record<string, unknown>; close: () => void };
type Win = { url: string; focus: () => Promise<Win>; navigate?: (url: string) => Promise<Win | null> };

function loadWorker() {
  const listeners: Record<string, Listener[]> = {};
  const shown: Shown[] = [];
  const tray: Tray[] = [];
  const windows: Win[] = [];
  type Fetch = (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; json: () => Promise<Record<string, unknown>> }>;
  const fetchMock = vi.fn<Fetch>(async () => ({ ok: true, json: async () => ({ ok: true, publicKey: "SERVER-KEY" }) }));
  const subscribe = vi.fn(async (opts: { applicationServerKey: unknown }) => ({
    endpoint: "https://push.example.test/new",
    options: opts,
    toJSON: () => ({ endpoint: "https://push.example.test/new", keys: { p256dh: "p", auth: "a" } }),
  }));
  const self = {
    location: { origin: "https://pause.test" },
    addEventListener: (type: string, fn: Listener) => (listeners[type] ??= []).push(fn),
    skipWaiting: vi.fn(),
    clients: {
      claim: vi.fn(),
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async (url: string) => ({ url })),
    },
    registration: {
      showNotification: vi.fn(async (title: string, options: Shown["options"]) => {
        shown.push({ title, options });
        // The tray keeps one notification per tag.
        const n: Tray = {
          tag: options.tag,
          data: options.data,
          close() {
            const k = tray.indexOf(n);
            if (k >= 0) tray.splice(k, 1);
          },
        };
        const i = tray.findIndex((t) => t.tag === options.tag);
        if (i >= 0) tray[i] = n;
        else tray.push(n);
      }),
      getNotifications: vi.fn(async () => [...tray]),
      pushManager: { subscribe },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8"), { self, fetch: fetchMock, URL, console });
  async function dispatch(type: string, event: Record<string, unknown>) {
    const waits: Promise<unknown>[] = [];
    for (const fn of listeners[type] ?? []) fn({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  }
  const push = (payload: Record<string, unknown>) => dispatch("push", { data: { json: () => payload, text: () => JSON.stringify(payload) } });
  const click = (data: Record<string, unknown>, action = "") => dispatch("notificationclick", { action, notification: { close: vi.fn(), data } });
  const win = (url: string, opts: { navigateFails?: boolean } = {}): Win => {
    const w: Win = {
      url,
      focus: vi.fn(async () => w),
      navigate: vi.fn(async (target: string) => {
        if (opts.navigateFails) throw new TypeError("not controlled");
        w.url = target;
        return w;
      }),
    };
    return w;
  };
  return { self, shown, tray, windows, fetchMock, subscribe, dispatch, push, click, win };
}

describe("service worker: push", () => {
  it("shows the alert with its tag, buttons, time and the screen a tap opens", async () => {
    const w = loadWorker();
    await w.push({ title: "Papa needs you now", body: "Rs 80,000", url: "/open/a2", tag: "alert-a2", urgent: true, kind: "urgent", alertId: "a2", checkId: "c1", holdId: "h1", who: "Papa", at: "2026-10-09T10:00:00.000Z", actions: [{ action: "block", title: "Block payment" }, { action: "fine", title: "It's fine" }] });
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0].title).toBe("Papa needs you now");
    expect(w.shown[0].options).toMatchObject({
      tag: "alert-a2",
      requireInteraction: true,
      renotify: true,
      timestamp: Date.parse("2026-10-09T10:00:00.000Z"),
      actions: [{ action: "block", title: "Block payment" }, { action: "fine", title: "It's fine" }],
      data: { url: "/open/a2", holdId: "h1", who: "Papa", alertId: "a2", checkId: "c1", kind: "urgent" },
    });
  });

  it("a newer notification about the same message replaces the older one; other messages stay", async () => {
    const w = loadWorker();
    await w.push({ title: "Heads-up", url: "/open/a1", tag: "alert-a1", urgent: false, kind: "headsup", alertId: "a1", checkId: "c1" });
    await w.push({ title: "Other", url: "/open/a9", tag: "alert-a9", urgent: false, kind: "headsup", alertId: "a9", checkId: "c9" });
    await w.push({ title: "Papa needs you now", url: "/open/a2", tag: "alert-a2", urgent: true, kind: "urgent", alertId: "a2", checkId: "c1" });
    expect(w.tray.map((n) => n.tag).sort()).toEqual(["alert-a2", "alert-a9"]);
    expect(w.shown[2].options.requireInteraction).toBe(true);
  });

  it("a push it cannot read still shows something, never nothing", async () => {
    const w = loadWorker();
    await w.dispatch("push", { data: { json: () => { throw new Error("not json"); }, text: () => "hello" } });
    expect(w.shown[0]).toMatchObject({ title: "Pause Button", options: { body: "hello", tag: "pause-button", data: { url: "/family" } } });
  });
});

describe("service worker: receipts", () => {
  const receipts = (w: ReturnType<typeof loadWorker>) =>
    w.fetchMock.mock.calls.filter(([url]) => url === "/api/push/receipt").map(([, init]) => JSON.parse(init!.body as string));

  it("confirms a push once its notification is on screen", async () => {
    const w = loadWorker();
    await w.push({ title: "Papa needs you now", url: "/open/a2", tag: "alert-a2", urgent: true, receipt: "d-1" });
    expect(w.shown).toHaveLength(1);
    expect(receipts(w)).toEqual([{ id: "d-1", shown: true, error: null }]);
  });

  it("says so when the phone would not show it (notifications blocked), and why", async () => {
    const w = loadWorker();
    w.self.registration.showNotification.mockRejectedValueOnce(Object.assign(new TypeError("No notification permission has been granted for this origin."), { name: "TypeError" }));
    await w.push({ title: "Papa needs you now", url: "/open/a2", tag: "alert-a2", urgent: true, receipt: "d-2" });
    expect(receipts(w)).toEqual([{ id: "d-2", shown: false, error: "TypeError" }]);
  });

  it("sends nothing for a push without a delivery id, and a failed receipt never fails the push", async () => {
    const w = loadWorker();
    await w.push({ title: "Test", url: "/family", tag: "t" });
    expect(receipts(w)).toEqual([]);
    w.fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await expect(w.push({ title: "Test", url: "/family", tag: "t", receipt: "d-3" })).resolves.toBeUndefined();
    expect(w.shown).toHaveLength(2);
  });
});

describe("service worker: tap", () => {
  it("opens the alert in the family window when one is open, never in an operator page", async () => {
    const w = loadWorker();
    const demo = w.win("https://pause.test/demo");
    const papa = w.win("https://pause.test/check/x");
    const family = w.win("https://pause.test/family/settings");
    w.windows.push(demo, papa, family);
    await w.click({ url: "/open/a2", alertId: "a2" });
    expect(family.focus).toHaveBeenCalled();
    expect(family.navigate).toHaveBeenCalledWith("https://pause.test/open/a2");
    expect(demo.navigate).not.toHaveBeenCalled();
    expect(papa.navigate).not.toHaveBeenCalled();
    expect(w.self.clients.openWindow).not.toHaveBeenCalled();
  });

  it("Papa's notification prefers his own window over the family one", async () => {
    const w = loadWorker();
    const family = w.win("https://pause.test/family");
    const papa = w.win("https://pause.test/history");
    w.windows.push(family, papa);
    await w.click({ url: "/hold/h7" });
    expect(papa.navigate).toHaveBeenCalledWith("https://pause.test/hold/h7");
    expect(family.navigate).not.toHaveBeenCalled();
  });

  it("with the app closed, a new window opens straight on the alert; a window that cannot be steered falls back to a new one", async () => {
    const w = loadWorker();
    await w.click({ url: "/open/a2" });
    expect(w.self.clients.openWindow).toHaveBeenCalledWith("https://pause.test/open/a2");
    const stuck = w.win("https://pause.test/family", { navigateFails: true });
    w.windows.push(stuck);
    await w.click({ url: "/open/a3" });
    expect(w.self.clients.openWindow).toHaveBeenLastCalledWith("https://pause.test/open/a3");
  });

  it("“Block payment” blocks it from the lock screen without opening the app, then says so", async () => {
    const w = loadWorker();
    w.fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, publicKey: null }) });
    await w.click({ url: "/open/a2", holdId: "h1", who: "Papa" }, "block");
    expect(w.fetchMock).toHaveBeenCalledWith("/api/family/holds/h1/decision", expect.objectContaining({ method: "POST", credentials: "same-origin", body: JSON.stringify({ decision: "block", confirm: false }) }));
    expect(w.self.clients.openWindow).not.toHaveBeenCalled();
    expect(w.shown[0]).toMatchObject({ title: "You blocked it", options: { tag: "hold-h1", data: { url: "/family/hold/h1?call=1" } } });
    // The follow-up's "Call Papa" button opens the payment with the dialer.
    await w.click(w.shown[0].options.data, "open");
    expect(w.self.clients.openWindow).toHaveBeenCalledWith("https://pause.test/family/hold/h1?call=1");
  });

  it("“Block payment” when the service refuses, or cannot be reached, says what to do instead", async () => {
    const w = loadWorker();
    w.fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Meera already blocked this payment." }) });
    await w.click({ holdId: "h1" }, "block");
    expect(w.shown[0]).toMatchObject({ title: "Could not block it", options: { body: "Meera already blocked this payment.", tag: "hold-h1" } });
    w.fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await w.click({ holdId: "h1" }, "block");
    expect(w.shown[1]).toMatchObject({ title: "Could not reach Pause Button", options: { data: { url: "/family/hold/h1" } } });
  });

  it("“It's fine” opens the approve step, which still needs the second confirm in the app", async () => {
    const w = loadWorker();
    await w.click({ url: "/open/a2", holdId: "h1" }, "fine");
    expect(w.self.clients.openWindow).toHaveBeenCalledWith("https://pause.test/family/hold/h1?approve=1");
  });
});

describe("service worker: subscription changes", () => {
  it("re-subscribes with the same key and tells the server the old endpoint", async () => {
    const w = loadWorker();
    const key = new Uint8Array([1, 2, 3]);
    await w.dispatch("pushsubscriptionchange", { oldSubscription: { endpoint: "https://push.example.test/old", options: { applicationServerKey: key } } });
    expect(w.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: key });
    const [url, init] = w.fetchMock.mock.calls.find((c) => c[0] === "/api/push/subscribe")!;
    expect(url).toBe("/api/push/subscribe");
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      subscription: { endpoint: "https://push.example.test/new", keys: { p256dh: "p", auth: "a" } },
      previousEndpoint: "https://push.example.test/old",
    });
  });

  it("without the old key it asks the server for the current one; without any key it does nothing", async () => {
    const w = loadWorker();
    await w.dispatch("pushsubscriptionchange", { oldSubscription: null });
    expect(w.fetchMock.mock.calls[0][0]).toBe("/api/push/key");
    expect(w.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: "SERVER-KEY" });
    const w2 = loadWorker();
    w2.fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ publicKey: null }) });
    await w2.dispatch("pushsubscriptionchange", {});
    expect(w2.subscribe).not.toHaveBeenCalled();
  });
});
