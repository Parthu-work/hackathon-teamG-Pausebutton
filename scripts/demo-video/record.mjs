#!/usr/bin/env node
// Records the Pause Button demo video against a running production build.
//
// Three "phones" (Mr Rao, Arjun, Meera) live in one 1920×1080 studio page as
// iframes whose window.name carries the persona's token (the same trick the
// /demo panel uses), beside the service's live event log. A scripted cursor
// taps the real screens; captions and chapter cards are drawn by the studio
// page. Every frame is captured over CDP and encoded with ffmpeg afterwards.
//
//   BASE=http://localhost:3300 OUT=./out FFMPEG=/path/to/ffmpeg node scripts/demo-video/record.mjs
//
// Needs: the production build running with DEMO_SIGNIN open, no OPERATOR_KEY,
// CRON_SECRET=demo-cron-key (or CRON_SECRET in the environment), and an ffmpeg
// with libx264 + aac. FAST=1 shortens every pause for a dry run.

import { chromium, request } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? "http://localhost:3300";
const OUT = path.resolve(process.env.OUT ?? path.join(here, "out"));
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const CRON_SECRET = process.env.CRON_SECRET ?? "demo-cron-key";
const FAST = !!process.env.FAST;
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",").map(Number)) : null; // e.g. ONLY=0,3 for a dry run of two chapters
const FONTS = path.resolve(here, "../../src/app/fonts");
const FRAMES = path.join(OUT, "frames");
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, FAST ? Math.min(ms, 150) : ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- the Android app's bridge, stood in for (same as e2e/native-app.spec.ts), on pages opened with ?app=1 ----------
function fakeAndroidApp(opts) {
  if (!location.search.includes("app=1")) return;
  const state = { paired: false, userName: null, token: null, consented: false, listenerOn: false, batteryUnrestricted: false, waiting: 0, lastError: null, lastDeliveredAt: null, today: "", notifications: { permission: "prompt", canAskAgain: true }, calls: [] };
  const listeners = {};
  let next = 0;
  const methods = ["pair", "watcherStatus", "openListenerSettings", "openBatterySettings", "disconnect", "notificationStatus", "requestNotifications", "openNotificationSettings", "pushAvailable"];
  window.__pbNative = state;
  window.__pbResume = () => (listeners["App.resume"] ?? []).forEach((l) => l.fn({}));
  window.androidBridge = { postMessage: () => {} };
  window.Capacitor = {
    PluginHeaders: [
      { name: "PauseButtonNative", methods: methods.map((name) => ({ name, rtype: "promise" })) },
      { name: "App", methods: [{ name: "addListener", rtype: "callback" }, { name: "removeListener", rtype: "promise" }] },
    ],
    nativeCallback: (plugin, _method, options, fn) => {
      const id = String(++next);
      (listeners[`${plugin}.${options.eventName}`] ??= []).push({ id, fn });
      return id;
    },
    nativePromise: async (plugin, method, options = {}) => {
      if (plugin === "App") {
        if (method === "removeListener") for (const key of Object.keys(listeners)) listeners[key] = listeners[key].filter((l) => l.id !== options.callbackId);
        return {};
      }
      state.calls.push(method);
      switch (method) {
        case "pair": {
          const res = await fetch(`${options.host}/api/device/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: options.code, name: opts.deviceName }) });
          const body = await res.json();
          if (!res.ok) return { ok: false, error: body.error };
          Object.assign(state, { paired: true, userName: body.userName, token: body.token });
          return { ok: true, userName: body.userName };
        }
        case "watcherStatus": {
          const { paired, userName, consented, listenerOn, batteryUnrestricted, waiting, lastError, lastDeliveredAt, today } = state;
          return { paired, userName, consented, listenerOn, batteryUnrestricted, waiting, lastError, lastDeliveredAt, today };
        }
        case "openListenerSettings":
          state.consented = true;
          state.listenerOn = true; // he switches it on in Android's list
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
          if (state.notifications.permission !== "denied" || state.notifications.canAskAgain) state.notifications = { permission: "granted", canAskAgain: true };
          return state.notifications;
        case "pushAvailable":
          return { available: false };
      }
      return {};
    },
  };
}

// ---------- the service: reset, personas, settings ----------
const api = await request.newContext({ baseURL: BASE });
const ok = async (p, what) => {
  const r = await p;
  if (!r.ok()) throw new Error(`${what}: ${r.status()} ${await r.text()}`);
  return r;
};
await ok(api.post("/api/demo/reset"), "reset");
const { tokens } = await (await ok(api.post("/api/demo/personas", { data: {} }), "personas")).json();
const H = { rao: { "x-pb-rao": tokens.rao }, arjun: { "x-pb-family": tokens.arjun }, meera: { "x-pb-family": tokens.meera } };
const RAO = `pb-rao:${tokens.rao}`, ARJUN = `pb-family:${tokens.arjun}`, MEERA = `pb-family:${tokens.meera}`;
await ok(api.patch("/api/me/settings", { headers: H.rao, data: { holdMinutes: 10, language: "en" } }), "rao settings");
const raoState = await (await ok(api.get("/api/me/state", { headers: H.rao }), "rao state")).json();
// Phones paired by an earlier take: the Connect screen must start empty.
for (const d of await (await ok(api.get("/api/me/devices", { headers: H.rao }), "devices")).json()) await ok(api.delete(`/api/me/devices/${d.id}`, { headers: H.rao }), "forget device");
await ok(api.patch("/api/family/settings", { headers: H.arjun, data: { hold: { protectedId: raoState.me.id, minutes: 10 } } }), "family settings");
log("service ready", BASE);

// ---------- the browser and the studio page ----------
const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--force-device-scale-factor=1"] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, baseURL: BASE, locale: "en-IN", timezoneId: "Asia/Kolkata", extraHTTPHeaders: { "x-real-ip": `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });
await context.addInitScript(fakeAndroidApp, { deviceName: "Redmi Note 12" });
const studioHtml = fs.readFileSync(path.join(here, "studio.html"), "utf8");
await context.route("**/__studio/**", (route) => {
  const u = new URL(route.request().url());
  if (u.pathname.startsWith("/__studio/fonts/")) {
    const file = path.join(FONTS, path.basename(u.pathname));
    if (fs.existsSync(file)) return route.fulfill({ status: 200, contentType: "font/woff2", body: fs.readFileSync(file), headers: { "cache-control": "public, max-age=86400" } });
    return route.fulfill({ status: 404, body: "" });
  }
  return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: studioHtml });
});
const page = await context.newPage();
page.on("pageerror", (e) => log("page error:", e.message));

// ---------- frame capture over CDP ----------
const cdp = await context.newCDPSession(page);
const index = [];
const pending = [];
let n = 0;
cdp.on("Page.screencastFrame", (ev) => {
  const file = path.join(FRAMES, `f${String(++n).padStart(6, "0")}.jpg`);
  index.push({ file, ts: ev.metadata.timestamp });
  pending.push(fs.promises.writeFile(file, Buffer.from(ev.data, "base64")));
  // One ack per frame; waiting ~40 ms caps the capture near 25 frames a second.
  setTimeout(() => cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => {}), FAST ? 0 : 40);
});
await page.goto(`${BASE}/__studio/`);
await page.evaluate(() => document.fonts.ready);
await sleep(300);
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });

// ---------- studio helpers ----------
const st = (m, ...a) => page.evaluate(([m, a]) => window.__studio[m](...a), [m, a]);
const timeline = [];
const mark = (text, kind = "caption") => timeline.push({ at: Date.now() / 1000, text, kind });
async function say(text, after = 900) {
  log("  »", text);
  mark(text);
  await st("caption", text);
  await sleep(after);
}
async function chapter(num, title, sub) {
  log(`== ${num} ${title}`);
  mark(title, "chapter");
  await st("caption", "");
  await st("unspot");
  await st("chapter", num, title, sub);
  await st("chap", `${String(num).padStart(2, "0")} · ${title}`);
  await sleep(3600);
  await st("hideCard");
  await sleep(700);
}
async function card(html, ms) {
  mark("", "card");
  await st("caption", "");
  await st("card", html);
  await sleep(ms);
  await st("hideCard");
  await sleep(600);
}
const F = { rao: page.frameLocator("#f-rao"), arjun: page.frameLocator("#f-arjun"), meera: page.frameLocator("#f-meera"), wide: page.frameLocator("#f-wide") };
async function setFrame(slot, name, src) {
  await st("setFrame", slot, name, src);
  await F[slot].locator("body").waitFor({ timeout: 30_000 });
  await sleep(900);
}
const frameOf = async (slot) => (await page.$(`#f-${slot}`)).contentFrame();
const see = (loc, timeout = 25_000) => loc.first().waitFor({ state: "visible", timeout });
const visible = (loc) => loc.filter({ visible: true });

async function moveTo(x, y) {
  await st("cursor", x, y);
  await page.mouse.move(x, y, { steps: 6 });
  await sleep(620);
}
async function tap(loc, { settle = 650 } = {}) {
  const el = loc.first();
  await el.waitFor({ state: "visible", timeout: 25_000 });
  await el.scrollIntoViewIfNeeded();
  // Playwright's own checks, without acting: the element is still, and nothing (a toast, a sheet) covers it.
  await el.hover({ trial: true, timeout: 25_000 });
  await sleep(220);
  const box = await el.boundingBox();
  if (!box) throw new Error("tap: element has no box");
  const x = box.x + box.width / 2, y = box.y + Math.min(box.height / 2, 44);
  await moveTo(x, y);
  await st("ripple", x, y);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
  await sleep(settle);
}
async function type(loc, text, delay = 42) {
  await tap(loc, { settle: 150 });
  await loc.first().fill("");
  await loc.first().pressSequentially(text, { delay: FAST ? 0 : delay });
  await sleep(350);
}
async function spot(loc, label, { below = false, hold = 2200 } = {}) {
  const el = loc.first();
  await el.waitFor({ state: "visible", timeout: 25_000 });
  await el.scrollIntoViewIfNeeded();
  await sleep(220);
  const b = await el.boundingBox();
  if (!b) return;
  await st("spot", b.x, b.y, b.width, b.height, label ?? "", below);
  await sleep(hold);
}
const unspot = () => st("unspot");
const layout = async (mode, active) => { await st("layout", mode, active); await sleep(950); };
const who = (slot, name, role) => st("who", slot, name, role);

/** Mr Rao's home, by the tab or the button on screen; a reload only when there is neither. */
async function raoHome() {
  const back = F.rao.getByRole("button", { name: /^(Back to home|Done)$/ });
  const tab = F.rao.getByRole("link", { name: "Check", exact: true });
  if (await visible(back).first().isVisible().catch(() => false)) await tap(visible(back));
  else if (await visible(tab).first().isVisible().catch(() => false)) await tap(visible(tab));
  else await setFrame("rao", RAO, "/");
  await see(F.rao.getByTestId("check-button"));
}
async function familyHome(slot, name) {
  const back = F[slot].getByRole("button", { name: "Back to home" });
  const tab = F[slot].getByRole("link", { name: "People" });
  if (await visible(back).first().isVisible().catch(() => false)) await tap(visible(back));
  else if (await visible(tab).first().isVisible().catch(() => false)) await tap(visible(tab));
  else await setFrame(slot, name, "/family");
  await see(F[slot].getByRole("heading", { name: "Who you protect" }));
}
/** Papa checks one of the example messages from his home screen and gets past STOP. */
async function raoChecks(example, { stop = true } = {}) {
  await tap(F.rao.getByRole("button", { name: example, exact: true }));
  await tap(F.rao.getByTestId("check-button"), { settle: 400 });
  if (stop) {
    await see(F.rao.getByRole("heading", { name: "STOP" }));
  }
}
const want = (num) => !ONLY || ONLY.has(num);
// A number nobody has signed up with yet, so the role screen (not his home) follows the code.
const freshNumber = `98${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const n0 = ONLY ? Math.min(...ONLY) : -1; // the first chapter of a partial run starts on the trio

// ---------- the phones ----------
// A page (not an API call) is let in by the session cookies, so the browser
// needs the demo personas' cookies before Papa's, Arjun's and Meera's frames
// load; each frame's window.name then says which of them it is. The fresh
// sign-up in chapter 1 happens before those cookies exist.
let householdReady = false;
async function household() {
  if (householdReady) return;
  await ok(context.request.post("/api/demo/personas", { data: {} }), "personas (cookies)");
  await st("setFrame", "arjun", ARJUN, "/family");
  await st("setFrame", "meera", MEERA, "/family");
  await F.arjun.getByRole("heading", { name: "Who you protect" }).waitFor({ timeout: 30_000 });
  await F.meera.getByRole("heading", { name: "Who you protect" }).waitFor({ timeout: 30_000 });
  householdReady = true;
}
let raoFrameIsPapa = false;
async function papa() {
  await household();
  if (raoFrameIsPapa) return;
  await who("rao", "Mr Rao", "Papa · protected");
  await setFrame("rao", RAO, "/");
  await see(F.rao.getByTestId("check-button"));
  raoFrameIsPapa = true;
}
if (want(1)) {
  await st("who", "rao", "Mr Rao", "a new phone · signing up");
  await st("setFrame", "rao", "fresh", "/welcome");
  await F.rao.getByRole("button", { name: "Get started" }).waitFor({ timeout: 30_000 });
}

try {
  // ======== 0 · cold open ========
  if (want(0)) {
    await card(
      `<span class="pm big"><i></i><i></i></span><h1>Pause Button</h1><p>A ten-minute pause between a scam and your parents' savings.</p>`,
      4200,
    );
    await card(
      `<div class="k">THE PROBLEM</div><h1 class="sm">The victim is alone with the caller.</h1>
       <ul><li>“Sir, this is CBI Mumbai. A parcel in your name has illegal items. Stay on the call, tell no one, and transfer Rs 80,000.”</li>
       <li>Digital arrest, fake KYC, parcel fees, lottery wins: the script changes, the pressure is the same.</li>
       <li>The family finds out after the money is gone. Pause Button puts them in the room before it goes.</li></ul>`,
      9000,
    );
  }

  // ======== 1 · getting in ========
  if (want(1)) {
    await chapter(1, "Getting in", "A phone number, a one-time code, and a name.");
    await st("callout", "One phone, one number.", [
      "A random 4-digit code: 5 minutes, one use, 5 wrong tries lock it",
      "Demo mode shows the code on screen, once. Production sends it by SMS",
      "A name is required, and every home screen greets by it",
    ]);
    await layout("solo", "rao");
    await say("Mr Rao installs Pause Button on his phone and taps Get started.");
    await tap(F.rao.getByRole("button", { name: "Get started" }));
    await say("His mobile number. Nothing else.");
    await type(F.rao.getByLabel("Mobile number"), freshNumber);
    await tap(F.rao.getByRole("button", { name: "Send code" }));
    const shown = F.rao.getByTestId("demo-code");
    await see(shown);
    await st("calloutStep", 0);
    await say("A random four-digit code. In demo mode it is shown on the screen, once; in production it arrives by SMS. It lasts five minutes and works one time.", 300);
    await spot(shown, "Random code · shown once (demo mode)", { hold: 3200 });
    await st("calloutStep", 1);
    await spot(F.rao.getByTestId("code-expiry"), "5-minute expiry · Resend after 30 s", { below: true, hold: 2200 });
    await unspot();
    const code = (await shown.textContent()).replace(/\D/g, "");
    await tap(F.rao.getByLabel("Code digit 1"), { settle: 100 });
    for (let i = 0; i < 4; i++) {
      await F.rao.getByLabel(`Code digit ${i + 1}`).fill(code[i]);
      await sleep(260);
    }
    await tap(F.rao.getByRole("button", { name: "Sign in", exact: true }));
    await see(F.rao.getByRole("heading", { name: "Who is this phone for?" }));
    await say("Who is this phone for? A name comes first: no name, no way on.");
    await type(F.rao.getByLabel("Your name"), "Ramesh Rao");
    await st("calloutStep", 2);
    await tap(F.rao.getByRole("button", { name: /I want protection/ }));
    await tap(F.rao.getByRole("button", { name: "Continue" }));
    await see(F.rao.getByRole("heading", { name: "Who should we tell when something looks wrong?" }));
    await say("Then the people who should be told: a son, a daughter, a friend. Each gets their own invite code on WhatsApp.", 3200);
    await setFrame("rao", "fresh", "/");
    const greeting = F.rao.getByRole("heading", { level: 1 }).filter({ hasText: /^Good (morning|afternoon|evening), Ramesh$/ });
    await see(greeting);
    await say("And home greets him by name: Good morning, Ramesh.", 300);
    await spot(greeting, "Greets him by his first name", { hold: 2600 });
    await unspot();
  }

  // ======== 2 · the household ========
  if (want(2)) {
    await chapter(2, "The household", "One service. Three phones. Everyone sees the same truth within two seconds.");
    await papa();
    await layout("trio");
    await say("Meet the Raos. Papa's phone on the left. Arjun and Meera, his son and daughter, are his trusted people.", 2800);
    await spot(F.arjun.getByText("Papa is protected"), "Arjun protects Papa and Mummy", { hold: 2400 });
    await unspot();
    await say("On the right, the service itself: every event, live, as the phones make it.", 300);
    await spot(page.locator("#server"), "GET /api/demo/events · the same log the operator sees", { hold: 2600 });
    await unspot();
    await say("Arjun decides how long Papa's payments wait for the family. Fifteen minutes.");
    await tap(F.arjun.getByRole("link", { name: "Settings" }));
    const papaHold = F.arjun.getByRole("group", { name: "Papa's payment hold time" });
    await tap(papaHold.getByRole("button", { name: "15 min" }));
    await see(F.arjun.getByText("Papa's hold time is 30 minutes").or(F.arjun.getByText("Papa's hold time is 15 minutes")));
    await spot(papaHold, "5 · 10 · 15 · 30 · 60 minutes · per person", { hold: 2600 });
    await unspot();
    await say("Five to sixty minutes, set per person. A change applies to the next paused payment. Papa can set it on his own phone too.");
    await tap(F.rao.getByRole("link", { name: "Settings" }));
    const holdTime = F.rao.getByTestId("hold-time");
    await see(holdTime.getByRole("button", { name: "15 min" }));
    await spot(holdTime, "The same setting, already on Papa's phone", { hold: 2600 });
    await unspot();
    await tap(F.arjun.getByRole("link", { name: "People" }));
    await raoHome();
  }

  // ======== 3 · a scam, paused ========
  if (want(3)) {
    await papa();
    if (!ONLY || n0 === 3) await layout("trio");
    await chapter(3, "A scam, paused", "The CBI parcel call. Rs 80,000. Nothing moves until the family answers.");
    await say("The message every family in India has heard of. Papa pastes it, or taps the example, and checks it.");
    await raoChecks("CBI parcel call");
    await say("STOP. Big, red, in plain words: do not pay, do not tap, do not call back, do not share an OTP. Arjun and Meera have already been told.", 3600);
    await tap(F.rao.getByTestId("stop-continue"));
    await see(F.rao.getByRole("heading", { name: "Do not pay. Hang up." }));
    await say("The verdict says what the message does and which words gave it away. No scores, no percentages: Papa gets a sentence he can act on.", 2600);
    const campaign = F.rao.getByTestId("campaign");
    if (await campaign.isVisible().catch(() => false)) {
      await spot(campaign, "Campaign radar · other families got this today", { hold: 2800 });
      await say("Campaign radar: this exact scam hit other households today, matched by fingerprint, never by storing their messages.", 200);
      await sleep(1600);
      await unspot();
    }
    const pausedLink = F.rao.getByRole("link", { name: /payment paused/ });
    await spot(pausedLink, "Rs 80,000 paused · counting down", { hold: 2200 });
    await say("And the money: Rs 80,000 is paused. Nothing moves until the family answers or the timer runs out.", 200);
    await unspot();
    await tap(pausedLink);
    const ring = F.rao.locator(".ring");
    await see(ring);
    await spot(ring, "15:00 · the time Arjun chose", { hold: 2400 });
    await say("Fifteen minutes, as Arjun set. Above Rs 50,000 the hold needs two keys: both Arjun and Meera must approve to release it. One Block settles it.", 200);
    await spot(F.rao.getByTestId("two-keys"), "Two keys above Rs 50,000", { below: true, hold: 3000 });
    await unspot();

    const urgent = visible(F.arjun.getByText(/It asks for Rs 80,000/));
    await see(urgent, 30_000);
    await st("dim", "arjun");
    await say("Arjun's phone opened the alert by itself: Papa got a scam message asking for Rs 80,000. Installed as an app, this is a push notification with Block built in.", 200);
    await spot(F.arjun.getByRole("heading", { name: "Papa got a scam message" }), "Arrived within one poll · 2 s", { below: true, hold: 2800 });
    await unspot();
    await tap(visible(F.arjun.getByRole("button", { name: "Open", exact: true })));
    await see(F.arjun.getByText("Rs 80,000 paused"));
    await spot(F.arjun.getByTestId("victim-message"), "The exact message Papa got", { below: true, hold: 2200 });
    await say("He reads the exact message Papa got, with the hold and the two keys. Then he answers in his own words.", 200);
    await unspot();
    await type(F.arjun.getByRole("textbox", { name: "Your message" }), "Papa, this is the same trick that got Sharma uncle. Do not pick up if they ring again.", 28);
    await tap(F.arjun.getByRole("button", { name: "Send and block this payment" }));
    await see(F.arjun.getByRole("heading", { name: "You blocked it" }));
    await st("dim", null);
    await say("One tap. The payment is cancelled for everyone, and every phone finds out on its next poll.");
    await see(F.meera.getByText("Papa is protected"), 30_000);
    await spot(F.meera.getByText("Papa is protected"), "Meera's alert cleared itself", { hold: 2000 });
    await unspot();
    await see(F.rao.getByRole("heading", { name: "Payment cancelled" }), 30_000);
    await say("Papa's screen: Payment cancelled. Arjun blocked it. And Arjun's own words, which land harder than anything an app could say.", 200);
    await spot(F.rao.getByText("“Papa, this is the same trick that got Sharma uncle. Do not pick up if they ring again.”"), "Arjun's words, on Papa's screen", { hold: 3400 });
    await unspot();
    await tap(F.arjun.getByRole("button", { name: "Back to home" }));
    await see(F.arjun.getByTestId("ledger"));
    await spot(F.arjun.getByTestId("ledger"), "The family ledger", { hold: 400 });
    await say("The family home keeps the ledger: one payment paused, Rs 80,000 kept in the family.", 3000);
    await unspot();
    await raoHome();
  }

  // ======== 4 · from the lock screen ========
  if (want(4)) {
    await papa();
    if (!ONLY || n0 === 4) await layout("trio");
    await chapter(4, "From the lock screen", "Meera blocks a payment without unlocking her phone.");
    await say("Later, a lottery message: a Rs 6,500 fee to claim a prize. Papa checks it.");
    await raoChecks("Lottery win");
    await tap(F.rao.getByTestId("stop-continue"));
    await who("meera", "Meera", "phone locked, in her bag");
    await setFrame("meera", MEERA, "/family/lock");
    const lockAlert = F.meera.getByTestId("lock-alert");
    await see(lockAlert.filter({ hasText: "Papa got a scam message" }), 30_000);
    await st("dim", "meera");
    await spot(lockAlert, "Lock screen · Block without unlocking", { below: true, hold: 2600 });
    await say("Meera's phone is locked. The alert is on the lock screen with Block built in; in the Android app this is a real notification action.", 1200);
    await unspot();
    await tap(F.meera.getByRole("button", { name: "Block payment" }));
    await see(F.meera.getByTestId("lock-blocked"));
    await st("dim", null);
    await see(F.rao.getByRole("heading", { name: "Payment cancelled" }), 30_000);
    await say("Blocked. She never unlocked the phone, and Papa's Rs 6,500 stays where it is.", 3200);
    await who("meera", "Meera", "daughter · trusted person");
    await setFrame("meera", MEERA, "/family");
    await raoHome();
  }

  // ======== 5 · not sure? ask ========
  if (want(5)) {
    await papa();
    if (!ONLY || n0 === 5) await layout("trio");
    await chapter(5, "Not sure? Ask.", "Suspicious is not scam. Clearing a message needs everyone; one “scam” settles it.");
    await say("Not every message is a scam. A courier fee of Rs 1,850 is only suspicious.");
    await raoChecks("Courier fee", { stop: false });
    await see(F.rao.getByRole("heading", { name: "Be careful. Ask Arjun before you pay." }));
    await say("Be careful, it says. Ask Arjun before you pay. One tap asks the family.", 1400);
    await tap(F.rao.getByRole("button", { name: "Ask Arjun" }));
    await see(F.rao.getByText("Waiting for Arjun and Meera…"));
    await see(visible(F.arjun.getByRole("heading", { name: "Is this message safe?" })), 30_000);
    await tap(visible(F.arjun.getByRole("button", { name: "Open", exact: true })));
    await tap(F.arjun.getByRole("button", { name: "This is not a scam" }));
    await see(F.rao.getByText("Arjun: not a scam"), 30_000);
    await spot(F.rao.getByText("Waiting for Meera…"), "One “fine” is not enough", { hold: 2200 });
    await say("Arjun says it is fine. That is not enough: clearing a message needs everyone he trusts. One “scam” from anyone would settle it the other way.", 1800);
    await unspot();
    await see(visible(F.meera.getByRole("heading", { name: "Is this message safe?" })), 30_000);
    await tap(visible(F.meera.getByRole("button", { name: "Open", exact: true })));
    await tap(F.meera.getByRole("button", { name: "This is not a scam" }));
    await see(F.rao.getByRole("heading", { name: "Arjun and Meera checked it. It is not a scam." }), 30_000);
    await say("Both agree. Papa's screen says so, and names who checked it.", 3000);
    await tap(F.rao.getByRole("button", { name: "Done" }));
    await say("And a real bank alert? Safe, in one line.");
    await raoChecks("Real bank alert", { stop: false });
    await see(F.rao.getByRole("heading", { name: "This looks like a normal bank message." }));
    await spot(F.rao.getByRole("button", { name: "Ask Arjun" }), "Ask family on every verdict, SAFE included", { below: true, hold: 600 });
    await say("No scores, no percentages, ever. And “Ask Arjun” stays on every verdict, SAFE included: the family is one tap away.", 3400);
    await unspot();
    await raoHome();
  }

  // ======== 6 · the link ========
  if (want(6)) {
    await papa();
    if (!ONLY || n0 === 6) await layout("trio");
    await chapter(6, "The link", "Family reports a fake bank domain. A reviewer blocks it for everyone, live.");
    await say("A fake bank link: update your KYC at sbi-kyc-verify.in. Papa checks it; Arjun looks at the link itself.");
    await raoChecks("Bank KYC link");
    await tap(F.rao.getByTestId("stop-continue"));
    await see(visible(F.arjun.getByRole("heading", { name: "Papa got a scam message" })), 30_000);
    await tap(visible(F.arjun.getByRole("button", { name: "Open", exact: true })));
    await tap(F.arjun.getByTestId("link-row"));
    await see(F.arjun.getByRole("heading", { name: "The link in Papa's message" }));
    await st("dim", "arjun");
    await spot(F.arjun.locator("b.grow", { hasText: "sbi-kyc-verify.in" }), "Pretends to be SBI · not an SBI address", { hold: 2400 });
    await say("sbi-kyc-verify.in pretends to be SBI. Arjun reports it, and sees how many families that protects.", 600);
    await unspot();
    await tap(F.arjun.getByTestId("report-link"));
    await see(F.arjun.getByText("Reported. Thank you."));
    await spot(F.arjun.getByText(/\d+ families protected/), "Reported", { hold: 1800 });
    await unspot();
    await st("dim", null);
    await who("wide", "Operator console", "route /reports");
    await setFrame("wide", "", "/reports");
    await layout("wide");
    const row = F.wide.getByTestId("report-sbi-kyc-verify.in");
    await see(row);
    await spot(row, "Another family had already reported it", { hold: 600 });
    await say("Reports land in a review queue. One tap puts the domain on the live blocklist: no redeploy, no database edit.", 1800);
    await unspot();
    await tap(row.getByRole("button", { name: "Block" }));
    await see(row.filter({ hasText: "BLOCKED" }));
    await sleep(1200);
    await layout("trio");
    await see(F.arjun.getByText("Blocked for everyone"), 30_000);
    await spot(F.arjun.getByText("Blocked for everyone"), "On Arjun's phone within 2 s", { hold: 600 });
    await say("Arjun's phone hears about it within two seconds: blocked for everyone.", 2600);
    await unspot();
    await tap(F.arjun.locator(".back"));
    await tap(F.arjun.getByRole("button", { name: "It's a scam" }));
    await who("wide", "Operator console", "route /campaigns");
    await setFrame("wide", "", "/campaigns");
    await layout("wide");
    await see(F.wide.getByRole("heading", { name: "Campaigns, last 24 hours" }));
    await say("Campaign radar groups today's checks by message fingerprint, so the service can say “other families got this today” without ever storing their text.", 5200);
    await layout("trio");
    await familyHome("arjun", ARJUN);
    await raoHome();
  }

  // ======== 7 · the phone reads it itself ========
  if (want(7)) {
    await papa();
    if (!ONLY || n0 === 7) await layout("trio");
    await chapter(7, "The phone reads it itself", "The Android app forwards every new message. Each is stored once and checked once.");
    await say("With the Android app, Papa does nothing: the phone sends each new SMS or WhatsApp message as it arrives. Here a simulated inbox plays the phone.");
    await tap(F.rao.getByRole("link", { name: "Open the simulated inbox" }));
    await tap(F.rao.getByRole("button", { name: "Receive a test scam message" }));
    const shareBtn = F.rao.getByRole("button", { name: /^Share/ });
    await see(shareBtn);
    const row = F.rao.locator(".card", { has: shareBtn });
    await spot(row, "Stored once · checked once · Idempotency-Key", { hold: 600 });
    await say("The phone sends each message with an Idempotency-Key. The service stores one row and runs one check per key, even if the phone retries or the network duplicates it.", 3800);
    await unspot();
    await say("A failed check is never silent: the row says so, Papa can tap to check again, and the 30-minute sync job retries it.", 3400);
    await raoHome();
    const banner = F.rao.getByRole("alert");
    await see(banner);
    await spot(banner, "Possible scam · from the message that just arrived", { below: true, hold: 600 });
    await say("Back home, the banner is already up: possible scam, do not reply. Arjun got a quiet heads-up; nobody gets woken up for a message Papa has not acted on.", 3600);
    await unspot();
    const headsUp = visible(F.arjun.getByRole("button", { name: /^(Mark as handled|Open)$/ }));
    if (await headsUp.first().isVisible().catch(() => false)) {
      await st("dim", "arjun");
      if ((await headsUp.first().textContent()) === "Open") await tap(headsUp);
      const handled = visible(F.arjun.getByRole("button", { name: "Mark as handled" }));
      if (await handled.first().isVisible().catch(() => false)) {
        await spot(handled, "A heads-up, not an alarm", { hold: 1200 });
        await unspot();
        await tap(handled);
      }
      await st("dim", null);
      await say("Arjun marks it handled. Only a payment, or a scam Papa is about to act on, makes a phone ring.", 2600);
    }
    await familyHome("arjun", ARJUN);
    await familyHome("meera", MEERA);
  }

  // ======== 8 · in his language ========
  if (want(8)) {
    await papa();
    if (!ONLY || n0 === 8) await layout("trio");
    await chapter(8, "In his language", "Hindi and Telugu: every screen, every warning, every verdict.");
    await say("Papa reads Hindi. Every screen and every verdict follow him.");
    await tap(F.rao.getByRole("link", { name: "Settings" }));
    await tap(F.rao.getByTestId("language-row"));
    await tap(F.rao.getByRole("radio", { name: /हिन्दी/ }));
    await tap(F.rao.getByRole("button", { name: "Save" }));
    await sleep(1200);
    await setFrame("rao", RAO, "/");
    await st("dim", "rao");
    await say("A Hindi lottery scam, caught in Hindi.");
    await tap(F.rao.getByRole("button", { name: "लॉटरी (Hindi)" }));
    await tap(F.rao.getByTestId("check-button"), { settle: 400 });
    await see(F.rao.getByTestId("stop-continue"));
    await sleep(2200);
    await tap(F.rao.getByTestId("stop-continue"));
    const dhokha = F.rao.locator("[data-verdict=SCAM]").first();
    await see(dhokha);
    await spot(dhokha, "धोखा · SCAM", { below: true, hold: 600 });
    await say("The same checker, the same family alerts, in his words. Telugu too, and the strings live in one file per language for a native speaker to sign off.", 3800);
    await unspot();
    await st("dim", null);
    await ok(api.patch("/api/me/settings", { headers: H.rao, data: { language: "en" } }), "english again");
    await setFrame("rao", RAO, "/");
  }

  // ======== 9 · the Android app ========
  if (want(9)) {
    await papa();
    if (!ONLY || n0 === 9) await layout("trio");
    await chapter(9, "The Android app", "A real app: reads messages on the phone, asks permission only after saying why, pushes alerts to the lock screen.");
    await st("callout", "A real Android app.", [
      "Capacitor: the same screens in a WebView, no browser bar, no Chrome needed",
      "Reads SMS and WhatsApp notifications on the phone, after consent, and sends them once",
      "Every permission is explained first; every “no” leaves the app usable",
      "FCM push: lock-screen Block, delivery receipts, a 30-minute background sync",
    ]);
    await layout("solo", "rao");
    await say("In a browser, Connect gives Papa a pairing code and a link into the app.");
    await setFrame("rao", RAO, "/watch/connect");
    await tap(F.rao.getByRole("button", { name: "Connect this phone" }));
    const openApp = F.rao.getByRole("link", { name: "Open the Pause Button app" });
    await see(openApp);
    await spot(openApp, "pausebutton://pair?code=… · the link only fills in the code", { hold: 600 });
    await say("The link only fills the code in: nothing pairs without a tap on the phone, so a stranger's link can never hand the watcher to their server.", 3600);
    await unspot();
    await st("calloutStep", 0);
    await who("rao", "Mr Rao", "the Android app");
    await setFrame("rao", RAO, "/watch/connect?app=1");
    await say("Inside the app itself, the phone pairs on its own.");
    await tap(F.rao.getByRole("button", { name: "Connect this phone" }));
    await see(F.rao.getByTestId("this-phone").filter({ hasText: "Connected as Mr Rao" }));
    await spot(F.rao.getByTestId("phone-card"), "Redmi Note 12 · the server knows the phone", { below: true, hold: 600 });
    await say("Connected as Mr Rao. The server lists the phone, when it last synced, and whether anything is waiting on it.", 2600);
    await unspot();
    await st("calloutStep", 1);
    await say("Message reading is off until he agrees. The app says what it reads and what it never does, before Android asks anything.");
    await tap(F.rao.getByRole("button", { name: "Allow message reading" }));
    const dialog = F.rao.getByRole("dialog");
    await see(dialog.filter({ hasText: "What we read" }));
    await spot(dialog, "Consent first · then Android's own screen", { hold: 3200 });
    await unspot();
    await tap(F.rao.getByTestId("reading-continue"));
    await (await frameOf("rao")).evaluate(() => window.__pbResume());
    await sleep(900);
    await st("calloutStep", 2);
    await say("Back from Android's list, reading is on. Had he said no, pasting and forwarding would still work.");
    await tap(F.rao.getByRole("button", { name: "Allow running in the background" }));
    await tap(F.rao.getByTestId("battery-continue"));
    await (await frameOf("rao")).evaluate(() => window.__pbResume());
    await see(F.rao.getByText("Allowed to run in the background"));
    await say("Allowed to run in the background: a 30-minute WorkManager job flushes the outbox, refreshes settings and reports in, so the server can flag a phone that goes quiet.", 3400);
    await setFrame("rao", RAO, "/?app=1");
    const ask = F.rao.getByTestId("native-notifications-ask");
    await see(ask);
    await spot(ask, "The reason, before Android's prompt", { below: true, hold: 600 });
    await say("Notifications: the reason first, then the system prompt, and never again after a no. The way back is Settings, not nagging.", 2800);
    await unspot();
    await tap(ask.getByRole("button", { name: "Continue" }));
    await st("calloutStep", 3);
    await sleep(1600);
    await who("wide", "/download", "the APK, built and published by CI on every merge");
    await setFrame("wide", "", "/download");
    await layout("wide");
    await see(F.wide.getByRole("heading", { name: "Get Pause Button" }));
    await say("The APK builds in CI, runs its emulator tests, and publishes itself to the site on every merge. Scan, install, done. iPhone users add the web app to their home screen.", 5200);
  }

  // ======== 10 · under the hood ========
  if (want(10)) {
    await papa();
    if (!ONLY || n0 === 10) await layout("trio");
    await chapter(10, "Under the hood", "Built to be trusted: tests, an operator console, and a sync job that never runs twice at once.");
    await who("wide", "/demo", "the built-in demo panel: one household, one service");
    await setFrame("wide", "", "/demo");
    await layout("wide");
    await see(F.wide.getByText(/Demo panel/), 30_000);
    await say("The repo ships its own demo panel: Papa, Arjun and Meera side by side, a scam sample, a Wi-Fi drop, and the live event log you have watched all along.", 6000);
    const before = await st("syncText");
    await ok(api.post("/api/cron/sync", { headers: { authorization: `Bearer ${CRON_SECRET}` } }), "cron sync");
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && (await st("syncText")) === before) await sleep(500);
    await spot(page.locator("#sync"), "POST /api/cron/sync · every 30 minutes", { hold: 600 });
    await say("The sync job just ran: it re-checks failed messages, re-pushes unconfirmed alerts and flags quiet phones, under a database lease so two runs never overlap.", 4600);
    await unspot();
    await st("layout", "none");
    await sleep(600);
    await card(
      `<div class="k">WHAT IS REAL</div><h1 class="sm">Built to be trusted.</h1>
       <ul><li>268 unit and server tests on an in-memory Postgres · 38 end-to-end browser tests on three phones · Android unit and emulator tests in CI</li>
       <li>Exactly-once inbox with Idempotency-Key · two keys above Rs 50,000 · holds of 5 to 60 minutes · random one-time sign-in codes, rate-limited</li>
       <li>Web Push for browsers and iPhone, FCM for the Android app, lock-screen Block, delivery receipts</li>
       <li>Hindi and Telugu · no scores or percentages for Mr Rao · campaign radar without storing anyone's message · checks kept 24 hours, then gone</li></ul>`,
      11_000,
    );
    await card(
      `<span class="pm big"><i></i><i></i></span><h1>Pause Button</h1><p>Ten minutes between a scam and the money. The family in the room.</p><p class="url">hackathon-teamg-pausebutton-production.up.railway.app</p>`,
      6000,
    );
  }
} catch (e) {
  log("FAILED:", e?.stack ?? e);
  await page.screenshot({ path: path.join(OUT, "error.png") }).catch(() => {});
  process.exitCode = 1;
}

// ---------- finish: stop the capture, encode, subtitles ----------
await sleep(400);
await cdp.send("Page.stopScreencast").catch(() => {});
await sleep(300);
await Promise.all(pending);
await browser.close().catch(() => {});
await api.dispose();

index.sort((a, b) => a.ts - b.ts);
if (!index.length) throw new Error("no frames captured");
const t0 = index[0].ts;
let list = "";
for (let i = 0; i < index.length; i++) {
  const d = i + 1 < index.length ? Math.max(index[i + 1].ts - index[i].ts, 1 / 120) : 2.5;
  list += `file '${index[i].file}'\nduration ${d.toFixed(4)}\n`;
}
list += `file '${index[index.length - 1].file}'\n`;
fs.writeFileSync(path.join(OUT, "frames.txt"), list);
const total = index[index.length - 1].ts - t0 + 2.5;
fs.writeFileSync(path.join(OUT, "timeline.json"), JSON.stringify({ t0, total, frames: index.length, timeline }, null, 2));
log(`captured ${index.length} frames, ${total.toFixed(1)} s`);

// SRT: each caption lasts until the next caption, chapter card or 9 seconds, whichever comes first.
const srtTime = (s) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), sec = Math.floor((ms % 60_000) / 1000), r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(r).padStart(3, "0")}`;
};
let srt = "", k = 0;
for (let i = 0; i < timeline.length; i++) {
  const e = timeline[i];
  if (e.kind !== "caption") continue;
  const start = e.at - t0;
  const next = timeline[i + 1];
  const end = Math.min(next ? next.at - t0 : total, start + 9);
  srt += `${++k}\n${srtTime(start)} --> ${srtTime(end)}\n${e.text}\n\n`;
}
fs.writeFileSync(path.join(OUT, "pause-button-demo.srt"), srt);
// The narration script, chapter by chapter, with timestamps.
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
let md = "# Pause Button · demo narration\n\nEach line is what the caption says at that moment; read it as the voice-over.\n\n";
for (const e of timeline) {
  if (e.kind === "chapter") md += `\n## ${mmss(e.at - t0)} · ${e.text}\n\n`;
  else if (e.kind === "caption") md += `- **${mmss(e.at - t0)}** ${e.text}\n`;
}
fs.writeFileSync(path.join(OUT, "narration.md"), md);

function run(args, what) {
  log("ffmpeg:", what);
  const r = spawnSync(FFMPEG, args, { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${what}`);
}
const silent = path.join(OUT, "pause-button-demo-silent.mp4");
run(["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(OUT, "frames.txt"), "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-movflags", "+faststart", silent], "encode");
// A quiet pad under the picture, so the cut is not silent before a voice-over is added (two chords, slowly crossfading).
const chordA = "0.30*sin(2*PI*110*t)+0.22*sin(2*PI*164.81*t)+0.16*sin(2*PI*220*t)+0.10*sin(2*PI*329.63*t)";
const chordF = "0.30*sin(2*PI*87.31*t)+0.22*sin(2*PI*130.81*t)+0.16*sin(2*PI*174.61*t)+0.10*sin(2*PI*261.63*t)";
const mix = "(0.5+0.5*sin(2*PI*t/44))";
const expr = `(${chordA})*${mix}+(${chordF})*(1-${mix})`;
const pad = `aevalsrc='${expr}*(0.85+0.15*sin(2*PI*0.11*t))':s=48000:d=${total.toFixed(2)}`;
const final = path.join(OUT, "pause-button-demo.mp4");
run([
  "-hide_banner", "-loglevel", "error", "-y", "-i", silent, "-f", "lavfi", "-i", pad,
  "-filter_complex", `[1:a]lowpass=f=1200,afade=t=in:d=4,afade=t=out:st=${Math.max(0, total - 6).toFixed(2)}:d=6,volume=0.16[a]`,
  "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", final,
], "music");
log("done:", final);
