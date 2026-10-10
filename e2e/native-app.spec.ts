import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

// The Android app's web half (contract C1): the same site, in a browser that
// plays the app. A stand-in for Capacitor's native bridge (window.androidBridge
// and the plugin headers its native side injects) answers as the phone would.
// Real: the screens, the server, pairing with a code, telling the server
// "disconnect". Standing in: Android (its permission prompt, its settings
// screens, the app coming back to the front). The last test is the same
// Connect screen in a plain browser, where it stays as it was.
//
// Each test signs up its own household with the demo sign-in code, so the
// family-phones tests (which share the demo personas) cannot get in the way.

type Notifications = { permission: "granted" | "denied" | "prompt"; canAskAgain: boolean };
type Fake = { notifications: Notifications; /** What the person taps on Android's prompt. */ answer: "granted" | "denied" };
type NativeState = { calls: string[]; listenerOn: boolean; batteryUnrestricted: boolean; notifications: Notifications };

/** Runs in the page before the app's scripts: what the Android app's WebView provides. */
function fakeAndroidApp(fake: Fake) {
  const state = {
    paired: false,
    userName: null as string | null,
    token: null as string | null,
    consented: false,
    listenerOn: false,
    batteryUnrestricted: false,
    waiting: 0,
    lastError: null,
    lastDeliveredAt: null,
    today: "",
    notifications: fake.notifications,
    calls: [] as string[],
  };
  const listeners: Record<string, { id: string; fn: (data: unknown) => void }[]> = {};
  let next = 0;
  const methods = ["pair", "watcherStatus", "openListenerSettings", "openAppInfo", "openBatterySettings", "disconnect", "notificationStatus", "requestNotifications", "openNotificationSettings", "pushAvailable"];
  const w = window as unknown as Record<string, unknown>;
  w.__pbNative = state;
  w.__pbResume = () => (listeners["App.resume"] ?? []).forEach((l) => l.fn({}));
  w.androidBridge = { postMessage: () => {} };
  w.Capacitor = {
    PluginHeaders: [
      { name: "PauseButtonNative", methods: methods.map((name) => ({ name, rtype: "promise" })) },
      { name: "App", methods: [{ name: "addListener", rtype: "callback" }, { name: "removeListener", rtype: "promise" }] },
    ],
    nativeCallback: (plugin: string, _method: string, options: { eventName: string }, fn: (data: unknown) => void) => {
      const id = String(++next);
      (listeners[`${plugin}.${options.eventName}`] ??= []).push({ id, fn });
      return id;
    },
    nativePromise: async (plugin: string, method: string, options: Record<string, string> = {}) => {
      if (plugin === "App") {
        if (method === "removeListener") for (const key of Object.keys(listeners)) listeners[key] = listeners[key].filter((l) => l.id !== options.callbackId);
        return {};
      }
      state.calls.push(method);
      switch (method) {
        case "pair": {
          const res = await fetch(`${options.host}/api/device/pair`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ code: options.code, name: "Test phone" }),
          });
          const body = await res.json();
          if (!res.ok) return { ok: false, error: body.error };
          Object.assign(state, { paired: true, userName: body.userName, token: body.token });
          return { ok: true, userName: body.userName };
        }
        case "watcherStatus": {
          const { paired, userName, consented, listenerOn, batteryUnrestricted, waiting, lastError, lastDeliveredAt, today } = state;
          // Android 13+, installed from the downloaded APK: notification access may be locked.
          return { paired, userName, consented, listenerOn, batteryUnrestricted, mayBeRestricted: true, waiting, lastError, lastDeliveredAt, today };
        }
        case "openListenerSettings":
          state.consented = true; // agreed on the consent screen, then left Android's list without switching it on
          return {};
        case "openBatterySettings":
          state.batteryUnrestricted = true;
          return {};
        case "disconnect":
          await fetch("/api/device/disconnect", { method: "POST", headers: { authorization: `Bearer ${state.token}` } });
          Object.assign(state, { paired: false, userName: null, token: null });
          return {};
        case "notificationStatus":
          return state.notifications;
        case "requestNotifications":
          // Android never asks again after "Don't allow" for good.
          if (state.notifications.permission !== "denied" || state.notifications.canAskAgain) {
            state.notifications = { permission: fake.answer, canAskAgain: fake.answer === "granted" };
          }
          return state.notifications;
        case "pushAvailable":
          return { available: false }; // a build without Firebase: nothing is registered
      }
      return {};
    },
  };
}

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => {})));
});

const randomPhone = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const randomByte = () => Math.floor(Math.random() * 254) + 1;

/** Signs a new person up on this phone with the demo sign-in code, as Mr Rao's app or a family member's. */
async function signUp(page: Page, phone: string, role: "protected" | "family", name: string) {
  const code = await page.request.post("/api/auth/code", { data: { phone } });
  expect(code.ok(), await code.text()).toBeTruthy();
  const { demoCode } = (await code.json()) as { demoCode: string };
  const signIn = await page.request.post("/api/auth/sign-in", { data: { phone, code: demoCode } });
  expect(signIn.ok(), await signIn.text()).toBeTruthy();
  const chosen = await page.request.post("/api/auth/role", { data: { role, name } });
  expect(chosen.ok(), await chosen.text()).toBeTruthy();
}

async function appPhone(browser: Browser, fake: Fake): Promise<Page> {
  // Each phone has its own address, as real phones do, so sign-ups here never use up another test's sign-in limit.
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": `10.${randomByte()}.${randomByte()}.${randomByte()}` } });
  contexts.push(ctx);
  await ctx.addInitScript(fakeAndroidApp, fake);
  return ctx.newPage();
}

const native = (page: Page) => page.evaluate(() => (window as unknown as { __pbNative: NativeState }).__pbNative);
const resume = (page: Page) => page.evaluate(() => (window as unknown as { __pbResume: () => void }).__pbResume());

test("in the Android app, Mr Rao's phone connects itself, and asks for each permission only after saying why", async ({ browser }) => {
  const page = await appPhone(browser, { notifications: { permission: "granted", canAskAgain: true }, answer: "granted" });
  await signUp(page, randomPhone(), "protected", "Lakshmi");
  await page.goto("/watch/connect");

  // No code to copy, no link: the app pairs itself.
  await page.getByRole("button", { name: "Connect this phone" }).click();
  await expect(page.getByTestId("this-phone")).toContainText("Connected as Lakshmi");
  await expect(page.getByTestId("phone-card")).toContainText("Test phone"); // the server knows it too
  await expect(page.getByText("Message reading is off")).toBeVisible();
  expect((await native(page)).calls).toContain("pair");

  // Message reading: what is read, first; then the app's consent screen and Android's list.
  await page.getByRole("button", { name: "Allow message reading" }).click();
  await expect(page.getByRole("dialog")).toContainText("What we read");
  await expect(page.getByRole("dialog")).toContainText("What we never do");
  expect((await native(page)).calls).not.toContain("openListenerSettings");
  await page.getByTestId("reading-continue").click();
  expect((await native(page)).calls).toContain("openListenerSettings");
  // Back in the app with access still off: it says what still works, and stays usable.
  await expect(page.getByTestId("cannot-read")).toHaveCount(0);
  await resume(page);
  await expect(page.getByTestId("cannot-read")).toContainText("You can still paste or forward them.");
  // Android 13+ locks the switch for an app from a downloaded APK: how to unlock it, and the way there.
  await expect(page.getByTestId("cannot-read")).toContainText("Allow restricted settings");
  await page.getByTestId("open-app-info").click();
  expect((await native(page)).calls).toContain("openAppInfo");

  // Running in the background: "Not now" asks Android nothing; Continue opens its prompt.
  await page.getByRole("button", { name: "Allow running in the background" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click();
  expect((await native(page)).calls).not.toContain("openBatterySettings");
  await page.getByRole("button", { name: "Allow running in the background" }).click();
  await page.getByTestId("battery-continue").click();
  await resume(page);
  await expect(page.getByText("Allowed to run in the background")).toBeVisible();

  // Disconnect here: the phone forgets its token and the server forgets the phone.
  await page.getByRole("button", { name: "Disconnect this phone" }).click();
  await page.getByRole("button", { name: "Yes, disconnect" }).click();
  await expect(page.getByRole("button", { name: "Connect this phone" })).toBeVisible();
  await expect(page.getByTestId("phone-card")).toHaveCount(0);
});

test("in the Android app, Mr Rao is told why before Android asks about notifications, and never asked again after no", async ({ browser }) => {
  const page = await appPhone(browser, { notifications: { permission: "prompt", canAskAgain: true }, answer: "denied" });
  await signUp(page, randomPhone(), "protected", "Lakshmi");

  // Home: the explanation, with Not now.
  await page.goto("/");
  await expect(page.getByTestId("native-notifications-ask")).toContainText("So your family's alerts reach you");
  await page.getByTestId("native-notifications-ask").getByRole("button", { name: "Not now" }).click();
  await expect(page.getByTestId("native-notifications-ask")).toHaveCount(0);
  expect((await native(page)).calls).not.toContain("requestNotifications");

  // Settings: turning Notifications on explains first, then Android asks; he says no.
  await page.getByRole("link", { name: "Settings" }).click();
  const toggle = page.getByRole("switch", { name: "Notifications" });
  await toggle.click(); // off
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click(); // on again: the explanation first
  await expect(page.getByRole("dialog")).toContainText("So your family's alerts reach you");
  expect((await native(page)).calls).not.toContain("requestNotifications");
  await page.getByTestId("notifications-continue").click();
  // (The home screen stays mounted, hidden, behind Settings: its banner says the same.)
  await expect(page.getByTestId("native-notifications-off").filter({ visible: true })).toContainText("Notifications are off for Pause Button");
  await expect(page.getByTestId("notify-row")).toContainText("Notifications are off for Pause Button");
  expect((await native(page)).calls.filter((c) => c === "requestNotifications")).toHaveLength(1);

  // The way back is Android's settings, never its prompt again.
  await page.getByRole("button", { name: "Turn on in Settings" }).click();
  expect((await native(page)).calls).toContain("openNotificationSettings");
  await toggle.click(); // off
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click(); // on: no explanation, no prompt
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  expect((await native(page)).calls.filter((c) => c === "requestNotifications")).toHaveLength(1);
});

test("in the Android app, a family member hears why before Android asks, on the home screen", async ({ browser }) => {
  // A household of their own: Lakshmi invites Ravi.
  const lakshmi = await appPhone(browser, { notifications: { permission: "granted", canAskAgain: true }, answer: "granted" });
  await signUp(lakshmi, randomPhone(), "protected", "Lakshmi");
  const ravisPhone = randomPhone();
  const invite = await lakshmi.request.post("/api/me/people", { data: { name: "Ravi", relation: "Son", phone: ravisPhone } });
  expect(invite.ok(), await invite.text()).toBeTruthy();
  const { inviteCode } = (await invite.json()) as { inviteCode: string };

  const ravi = await appPhone(browser, { notifications: { permission: "prompt", canAskAgain: true }, answer: "granted" });
  await signUp(ravi, ravisPhone, "family", "Ravi");
  expect((await ravi.request.post("/api/family/join", { data: { code: inviteCode } })).ok()).toBeTruthy();

  await ravi.goto("/family");
  const ask = ravi.getByTestId("native-notifications-ask");
  await expect(ask).toContainText("So you hear the moment Lakshmi needs you");
  await expect(ravi.getByTestId("push-hint")).toHaveCount(0); // the browser's hint is not shown in the app
  await ask.getByRole("button", { name: "Continue" }).click();
  await expect(ask).toHaveCount(0);
  expect((await native(ravi)).calls).toContain("requestNotifications");

  // (By the tab, not a reload: a reload would start the stand-in Android afresh.)
  await ravi.getByRole("link", { name: "Settings" }).click();
  await expect(ravi.getByText("Alerts reach this phone even when the app is closed.")).toBeVisible();
});

test("in a browser, Connect this phone still gives a code and the app's link, and each phone says whether it still syncs", async ({ browser }) => {
  // No stand-in Android here: a plain browser.
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": `10.${randomByte()}.${randomByte()}.${randomByte()}` } });
  contexts.push(ctx);
  const page = await ctx.newPage();
  await signUp(page, randomPhone(), "protected", "Lakshmi");
  await page.goto("/watch/connect");
  await page.getByRole("button", { name: "Connect this phone" }).click();
  const href = await page.getByRole("link", { name: "Open the Pause Button app" }).getAttribute("href");
  expect(href).toMatch(/^pausebutton:\/\/pair\?code=/);
  const code = new URL(href!).searchParams.get("code")!;
  await expect(page.getByText(code, { exact: true })).toBeVisible();

  // The phone to be watched trades the code, as the app does.
  expect((await page.request.post("/api/device/pair", { data: { code, name: "Test phone" } })).ok()).toBeTruthy();
  await expect(page.getByText("The app is connected.")).toBeVisible();
  const card = page.getByTestId("phone-card");
  await expect(card).toContainText("Test phone");
  await expect(card.getByTestId("not-syncing")).toHaveCount(0);
  await expect(card.getByTestId("phone-sync")).toHaveCount(0);

  // Later the server's sync job finds it quiet for over an hour, with messages stuck on it
  // (the job is not run here: the list the server sends says so).
  const lastSyncAt = new Date(Date.now() - 90 * 60_000).toISOString();
  await page.route("**/api/me/devices", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const devices = (await response.json()) as Record<string, unknown>[];
    await route.fulfill({ response, json: devices.map((d) => ({ ...d, notSyncing: true, lastSeenAt: lastSyncAt, lastSyncAt, waiting: 3 })) });
  });
  await expect(card.getByTestId("not-syncing")).toContainText("Not syncing since");
  await expect(card.getByTestId("not-syncing")).toContainText("Open the Pause Button app on that phone.");
  await expect(card.getByTestId("phone-sync")).toContainText("Last sync at");
  await expect(card.getByTestId("phone-sync")).toContainText("3 messages waiting to be sent");
});
