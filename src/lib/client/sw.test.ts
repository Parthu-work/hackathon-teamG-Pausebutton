import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// public/sw.js runs in the phone's browser, in the background. Here it runs
// against a fake ServiceWorkerGlobalScope, one event at a time.

type Client = {
  url: string;
  frameType?: string;
  focused?: boolean;
  visibilityState?: "visible" | "hidden";
  postMessage: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  navigate?: ReturnType<typeof vi.fn>;
};

const ORIGIN = "https://pb.example";
let clients: Client[];
let listeners: Record<string, (event: unknown) => void>;
let self: ReturnType<typeof makeSelf>;

function makeSelf() {
  return {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    skipWaiting: vi.fn(),
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: vi.fn(async () => clients),
      openWindow: vi.fn(async (url: string) => ({ url })),
    },
    registration: {
      showNotification: vi.fn(async () => {}),
      pushManager: { subscribe: vi.fn(async () => ({ toJSON: () => ({ endpoint: "https://push.example/new", keys: { p256dh: "p", auth: "a" } }) })) },
    },
  };
}

function client(url: string, extra: Partial<Client> = {}): Client {
  const c: Client = { url: ORIGIN + url, frameType: "top-level", focused: false, visibilityState: "hidden", postMessage: vi.fn(), focus: vi.fn(async () => c), ...extra };
  c.navigate ??= vi.fn(async () => c);
  return c;
}

/** Dispatches an event and waits for everything it passed to waitUntil. */
async function fire(type: string, event: Record<string, unknown>) {
  let pending: Promise<unknown> = Promise.resolve();
  listeners[type]({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
  return pending;
}

const push = (data: Record<string, unknown>) => fire("push", { data: { json: () => data, text: () => JSON.stringify(data) } });
const tap = (url: string) => {
  const notification = { data: { url }, close: vi.fn() };
  return fire("notificationclick", { notification }).then((r) => ({ r, notification }));
};

const fetchMock = vi.fn(async (url: string) => ({ json: async () => (url === "/api/push/key" ? { publicKey: "KEY" } : {}) }));

beforeEach(() => {
  clients = [];
  listeners = {};
  self = makeSelf();
  fetchMock.mockClear();
  const code = fs.readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
  new Function("self", "fetch", code)(self, fetchMock);
});

describe("service worker: incoming push", () => {
  const alert = { title: "Papa needs you now", body: "…", url: "/open?alert=a1", tag: "check-c1", urgent: true, app: "family" };

  it("shows a loud notification when the app is closed, the phone locked, or another app in front", async () => {
    clients = [client("/family", { visibilityState: "hidden" }), client("/demo", { visibilityState: "visible" })];
    await push(alert);
    expect(self.registration.showNotification).toHaveBeenCalledWith("Papa needs you now", expect.objectContaining({
      tag: "check-c1",
      renotify: true,
      requireInteraction: true,
      data: { url: "/open?alert=a1" },
    }));
  });

  it("does not duplicate the in-app alarm while the family app is on screen: it asks the page to refresh", async () => {
    const open = client("/family/activity", { visibilityState: "visible", focused: true });
    clients = [open];
    await push(alert);
    expect(self.registration.showNotification).not.toHaveBeenCalled();
    expect(open.postMessage).toHaveBeenCalledWith({ type: "pb-push", tag: "check-c1" });
  });

  it("an alert for one app still shows while the other app is on screen", async () => {
    clients = [client("/", { visibilityState: "visible" })]; // Papa's app is open; the push is for the family app
    await push(alert);
    expect(self.registration.showNotification).toHaveBeenCalled();
    clients = [client("/family", { visibilityState: "visible" })];
    await push({ ...alert, app: "rao", url: "/open?app=rao&to=%2Fhold%2Fh1" });
    expect(self.registration.showNotification).toHaveBeenCalledTimes(2);
  });

  it("ignores a demo-panel frame: only real windows count as on screen", async () => {
    clients = [client("/family", { visibilityState: "visible", frameType: "nested" })];
    await push(alert);
    expect(self.registration.showNotification).toHaveBeenCalled();
  });

  it("survives a payload that is not JSON", async () => {
    await fire("push", { data: { json: () => JSON.parse("nope"), text: () => "plain text" } });
    expect(self.registration.showNotification).toHaveBeenCalledWith("Pause Button", expect.objectContaining({ body: "plain text" }));
  });
});

describe("service worker: tapping a notification", () => {
  it("app in the background: brings the open window to the alert", async () => {
    const win = client("/family");
    clients = [win];
    const { notification } = await tap("/open?alert=a1");
    expect(notification.close).toHaveBeenCalled();
    expect(win.navigate).toHaveBeenCalledWith(`${ORIGIN}/open?alert=a1`);
    expect(win.focus).toHaveBeenCalled();
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it("app closed: starts it on the alert", async () => {
    await tap("/open?alert=a1");
    expect(self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/open?alert=a1`);
  });

  it("a window it cannot steer (not controlled yet) or the demo panel: opens a new one", async () => {
    clients = [client("/family", { navigate: vi.fn(async () => { throw new TypeError("not controlled"); }) }), client("/demo")];
    await tap("/open?alert=a1");
    expect(self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/open?alert=a1`);
  });

  it("never opens another site", async () => {
    await tap("https://evil.example/phish");
    expect(self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/family`);
  });
});

describe("service worker: subscription rotation", () => {
  it("registers the new subscription with the old endpoint, so the same person keeps their alerts", async () => {
    await fire("pushsubscriptionchange", { oldSubscription: { endpoint: "https://push.example/old" }, newSubscription: null });
    expect(self.registration.pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: "KEY" });
    const [url, init] = fetchMock.mock.calls.at(-1)! as unknown as [string, { body: string; method: string }];
    expect(url).toBe("/api/push/subscribe");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ subscription: { endpoint: "https://push.example/new", keys: { p256dh: "p", auth: "a" } }, oldEndpoint: "https://push.example/old" });
  });
});
