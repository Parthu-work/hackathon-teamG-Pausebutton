import { chromium, devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import examples from "../src/data/examples.json";

// Mr Rao, Arjun and Meera on three "phones" (browser contexts), one service.
// One "scam" (or Block) from either trusted person settles it; "not a scam"
// (or Approve) needs both of them.

const HEADED = !!process.env.HEADED;

// Every "phone" is its own browser context. Playwright does not close contexts
// made with browser.newContext() when a test ends, and a leftover Mr Rao or
// Arjun page would keep polling the same demo users and race the next test
// (a stale page can even consume a hold outcome first). So track them and
// close them all after each test.
const contexts: BrowserContext[] = [];
async function newContext(browser: Browser, options?: Parameters<Browser["newContext"]>[0]) {
  const ctx = await browser.newContext(options);
  await ctx.addInitScript(recordDialer);
  contexts.push(ctx);
  return ctx;
}
const browsers: Browser[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => {})));
  await Promise.all(browsers.splice(0).map((b) => b.close().catch(() => {})));
});

/**
 * The phones' dialer. "Call …" opens a tel: link. In a visible (headed)
 * browser that hands the number to the computer, which shows a system prompt
 * ("Open FaceTime?") over the window and swallows the next tap there. So each
 * test phone records the tel: link the app opened and cancels the hand-off,
 * through the Navigation API's "navigate" event, in headed and headless runs
 * alike. The app is unchanged: it still sets location.href to the tel: link.
 */
function recordDialer() {
  const w = window as Window & { __pbDialed?: string | null; navigation?: EventTarget };
  w.navigation?.addEventListener("navigate", (event) => {
    const e = event as Event & { destination: { url: string } };
    if (e.destination.url.startsWith("tel:")) {
      w.__pbDialed = e.destination.url;
      e.preventDefault();
    }
  });
}

/** Taps a "Call …" button and returns the number the phone's dialer was opened with. */
async function dialedNumber(page: Page, button: string | RegExp) {
  const dialed = () => page.evaluate(() => (window as Window & { __pbDialed?: string | null }).__pbDialed ?? null);
  await page.evaluate(() => ((window as Window & { __pbDialed?: string | null }).__pbDialed = null));
  await page.getByRole("button", { name: button }).click();
  await expect.poll(dialed, { message: "the dialer was not opened" }).not.toBeNull();
  return (await dialed())!;
}

/** In headed mode, put Mr Rao's window on the left and Arjun's on the right. */
async function placeWindow(page: Page, slot: number) {
  try {
    const cdp = await page.context().newCDPSession(page);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { left: 20 + slot * 430, top: 30, width: 420, height: 880 } });
  } catch {
    /* not Chromium: leave the window where it opened */
  }
}

async function phone(browser: Browser, persona: "Mr Rao" | "Mrs Rao" | "Arjun" | "Meera"): Promise<Page> {
  const page = await (await newContext(browser)).newPage();
  if (HEADED) await placeWindow(page, ["Mr Rao", "Arjun", "Meera", "Mrs Rao"].indexOf(persona));
  await page.goto("/sign-in");
  await page.getByRole("button", { name: `Continue as ${persona} (demo)` }).click();
  await page.waitForURL(persona === "Mr Rao" || persona === "Mrs Rao" ? "/" : "/family");
  return page;
}

/** Waits for the family phone to open the alert by itself, then opens it. */
async function openAlert(page: Page, heading: string) {
  await expect(page.getByRole("heading", { name: heading })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Open", exact: true }).click();
}

test.beforeEach(async ({ request }) => {
  // A server started with OPERATOR_KEY set would refuse this: fail here, not three tests later.
  const r = await request.post("/api/demo/reset");
  expect(r.ok(), await r.text()).toBeTruthy();
});

test("scam: STOP, payment held, one Block from Arjun settles it for everyone", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  const arjun = await phone(browser, "Arjun");
  const meera = await phone(browser, "Meera");

  await rao.getByRole("button", { name: "CBI parcel call" }).click();
  await rao.getByRole("button", { name: "Check this message" }).click();
  await expect(rao.getByRole("heading", { name: "STOP" })).toBeVisible();
  await rao.getByRole("button", { name: "I will not do anything" }).click();
  await expect(rao.getByRole("heading", { name: "Do not pay. Hang up." })).toBeVisible();
  await expect(rao.getByText("Arjun and Meera were alerted")).toBeVisible();
  const checkUrl = rao.url();
  // "Call Arjun" opens the phone's dialer with Arjun's number.
  await rao.getByRole("button", { name: "What to do now" }).click();
  expect(await dialedNumber(rao, /^Call Arjun$/)).toMatch(/^tel:\+91\d{10}$/);

  // Arjun's phone polls, buzzes and opens the alert by itself.
  await expect(arjun.getByRole("heading", { name: "Papa got a scam message" })).toBeVisible({ timeout: 10_000 });
  await arjun.getByRole("button", { name: "Open" }).click();
  await expect(arjun.getByText("Rs 80,000 paused")).toBeVisible();
  // Once he opens the alert he reads the exact message Papa got.
  await expect(arjun.getByTestId("victim-message")).toContainText(
    "Sir this is CBI Mumbai. A parcel in your name has illegal items. Stay on the call, tell no one",
  );

  // F13: Rs 80,000 is above the two-key line, so the hold says so on both phones.
  await expect(arjun.getByTestId("two-keys")).toBeVisible();
  // Approve needs a second confirm; he keeps it blocked, sends advice, then blocks.
  await arjun.getByRole("button", { name: /^Approve/ }).click();
  await arjun.getByRole("button", { name: "No, keep it blocked" }).click();
  // Sends the advice and opens the dialer with Papa's number.
  expect(await dialedNumber(arjun, /Send and call Papa/)).toMatch(/^tel:\+91\d{10}$/);
  await arjun.getByTestId("block").click();
  await expect(arjun.getByRole("heading", { name: "You blocked it" })).toBeVisible();
  // Meera was alerted too; Arjun's Block settled it, so her alert is gone and Papa's card is green again.
  await expect(meera.getByText("Papa is protected")).toBeVisible({ timeout: 10_000 });

  // Mr Rao's phone jumps to the outcome on its next poll.
  await expect(rao.getByRole("heading", { name: "Payment cancelled" })).toBeVisible({ timeout: 10_000 });
  await expect(rao.getByText("Arjun blocked it.")).toBeVisible();
  await expect(rao.getByText("“Hang up. Do not pay or click anything.”")).toBeVisible();

  // Opening the payment page again lands on the outcome, not on "Locking the payment…".
  await rao.goto(`${checkUrl}/pay`);
  await expect(rao.getByRole("heading", { name: "Payment cancelled" })).toBeVisible();

  // F12: the family home now carries the ledger: one payment paused, Rs 80,000 kept.
  await arjun.getByRole("button", { name: "Back to home" }).click();
  await expect(arjun.getByTestId("ledger")).toContainText(/1\s*payment paused/);
  await expect(arjun.getByTestId("ledger")).toContainText("Rs 80,000");
  await expect(arjun.getByText("CBI parcel message")).toBeVisible();
});

test("F3 campaign radar: the CBI message is one other families got today", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  await rao.getByRole("button", { name: "CBI parcel call" }).click();
  await rao.getByTestId("check-button").click();
  await rao.getByTestId("stop-continue").click();
  await expect(rao.getByTestId("campaign")).toContainText(/\d+ other families got this today/);
  await expect(rao.getByText("How we know, without reading your messages")).toBeVisible();
});

test("F1 forward to Pause: share a message from the inbox, no copy, no paste", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  const arjun = await phone(browser, "Arjun");
  await rao.getByRole("link", { name: "Open the simulated inbox" }).click();
  await rao.getByRole("button", { name: "Receive a test scam message" }).click();
  await rao.getByRole("button", { name: "Share +91 9XXXX XXXXX" }).click();
  await rao.getByTestId("send-to-pause").click();
  await rao.waitForURL(/\/stop$/, { waitUntil: "commit" });
  await rao.getByTestId("stop-continue").click();
  await expect(rao.getByText("FORWARDED FROM WHATSAPP")).toBeVisible();
  await expect(rao.getByText("What they asked for")).toBeVisible();
  await expect(rao.getByText("Arjun and Meera were alerted")).toBeVisible();
  // Arjun's phone first opened the quiet heads-up for the inbox message; the forwarded
  // check brings the urgent alert (with the Rs 80,000 hold). Wait for that one, then open it.
  // (The router keeps the earlier alert screen mounted but hidden, so count only what shows.)
  await expect(arjun.getByText(/It asks for Rs 80,000/).filter({ visible: true })).toBeVisible({ timeout: 10_000 });
  await arjun.getByRole("button", { name: "Open", exact: true }).click();
  await expect(arjun.getByTestId("victim-message")).toContainText("Papa forwarded it from WhatsApp");
});

test("F1 forward to a signed-out phone: the text survives the welcome and sign-in screens", async ({ browser }) => {
  // The Android Share sheet opens /share in Chrome, which may not be signed in yet.
  const page = await (await newContext(browser)).newPage();
  const text = "Sir this is CBI Mumbai. A parcel in your name has illegal items. Stay on the call, tell no one, and transfer Rs 80,000 to the verification account.";
  await page.goto(`/share?${new URLSearchParams({ text, from: "whatsapp" })}`);
  await page.waitForURL("/welcome");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("button", { name: "Continue as Mr Rao (demo)" }).click();
  // Home picks the forwarded message up and checks it straight away.
  await page.waitForURL(/\/stop$/, { timeout: 15_000 });
  await page.getByTestId("stop-continue").click();
  await expect(page.getByText("FORWARDED FROM WHATSAPP")).toBeVisible();
});

test("F6 live-call guard: three questions, HANG UP, and Arjun is told at once", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  const arjun = await phone(browser, "Arjun");
  await rao.getByTestId("door-call").click();
  await expect(rao.getByRole("heading", { name: "Did they video-call you?" })).toBeVisible();
  await rao.getByRole("button", { name: "Yes, they did" }).click();
  await expect(rao.getByRole("heading", { name: "Did they ask for money, an OTP or a code?" })).toBeVisible();
  await rao.getByRole("button", { name: "No, they did not" }).click();
  await rao.getByRole("button", { name: "No, they did not" }).click();
  await expect(rao.getByRole("heading", { name: "HANG UP" })).toBeVisible({ timeout: 10_000 });
  await expect(rao.getByText("Arjun is calling you now")).toBeVisible();

  await openAlert(arjun, "Papa is on a scam call");
  await expect(arjun.getByRole("heading", { name: "Papa is on a scam call" })).toBeVisible();
  await expect(arjun.getByTestId("victim-message")).toContainText("Someone is calling me and says they are an officer.");
  await expect(arjun.getByText("Video call: yes")).toBeVisible();
  await arjun.getByRole("button", { name: "It's a scam" }).click();

  await rao.getByRole("button", { name: "I have hung up" }).click();
  await expect(rao.getByText("LIVE CALL")).toBeVisible();
  await expect(rao.getByText("What you told us")).toBeVisible();
});

test("F2 lock screen: Arjun blocks the payment from the notification without unlocking", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  const arjun = await phone(browser, "Arjun");
  await rao.getByRole("button", { name: "CBI parcel call" }).click();
  await rao.getByTestId("check-button").click();
  await rao.getByTestId("stop-continue").click();
  await arjun.goto("/family/lock");
  await expect(arjun.getByTestId("lock-alert")).toContainText("Papa got a scam message", { timeout: 10_000 });
  await expect(arjun.getByTestId("lock-alert")).toContainText("Rs 80,000 is paused");
  await arjun.getByRole("button", { name: "Block payment" }).click();
  await expect(arjun.getByTestId("lock-blocked")).toContainText("You blocked it");
  await expect(arjun.getByText("He never unlocked the phone")).toBeVisible();
  await expect(rao.getByRole("heading", { name: "Payment cancelled" })).toBeVisible({ timeout: 10_000 });
});

test("F11 advice in his own words: a sentence from Arjun lands on Papa's screen", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  const arjun = await phone(browser, "Arjun");
  await rao.getByRole("button", { name: "CBI parcel call" }).click();
  await rao.getByTestId("check-button").click();
  await rao.getByTestId("stop-continue").click();
  await openAlert(arjun, "Papa got a scam message");
  await arjun.getByRole("textbox", { name: "Your message" }).fill("Papa, this is the same trick that got Sharma uncle. Do not pick up if they ring again.");
  await expect(arjun.getByText("86 / 200")).toBeVisible();
  await arjun.getByRole("button", { name: "Send and block this payment" }).click();
  await expect(arjun.getByRole("heading", { name: "You blocked it" })).toBeVisible();
  await expect(rao.getByRole("heading", { name: "Payment cancelled" })).toBeVisible({ timeout: 10_000 });
  await expect(rao.getByText("“Papa, this is the same trick that got Sharma uncle. Do not pick up if they ring again.”")).toBeVisible();
});

test("F9 reported domains: Arjun reports the fake bank link, a reviewer blocks it", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  const arjun = await phone(browser, "Arjun");
  await rao.getByRole("button", { name: "Bank KYC link" }).click();
  await rao.getByTestId("check-button").click();
  await rao.getByTestId("stop-continue").click();
  await openAlert(arjun, "Papa got a scam message");
  await arjun.getByTestId("link-row").click();
  await expect(arjun.getByRole("heading", { name: "The link in Papa's message" })).toBeVisible();
  // The previous screen stays mounted but hidden (Next keeps visited routes alive), so scope to this screen's domain line.
  await expect(arjun.locator("b.grow", { hasText: "sbi-kyc-verify.in" })).toBeVisible();
  await expect(arjun.getByText("Pretends to be SBI. Not a SBI address.")).toBeVisible();
  await arjun.getByTestId("report-link").click();
  await expect(arjun.getByText("Reported. Thank you.").first()).toBeVisible();
  await expect(arjun.getByText(/\d+ families protected/)).toBeVisible();

  // The operator's review queue: another family reported it first, Arjun is "1 more". Block puts it on the live blocklist.
  const ops = await (await newContext(browser)).newPage();
  await ops.goto("/reports");
  const row = ops.getByTestId("report-sbi-kyc-verify.in");
  await expect(row).toContainText("1 more");
  await row.getByRole("button", { name: "Block" }).click();
  await expect(row).toContainText("BLOCKED");
  await expect(arjun.getByText("Blocked for everyone")).toBeVisible({ timeout: 10_000 });

  // Blocked in error? The same screen takes it off the live blocklist, no database edit.
  await row.getByRole("button", { name: "Unblock", exact: true }).click();
  await expect(row).toContainText("REJECTED");
  await expect(ops.getByText("sbi-kyc-verify.in is no longer blocked")).toBeVisible();
});

test("F5 Hindi: every screen and the verdict speak Hindi after the switch", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  await rao.goto("/settings");
  await rao.getByTestId("language-row").click();
  await rao.getByRole("radio", { name: /हिन्दी/ }).click();
  await rao.getByRole("button", { name: "Save" }).click();
  await rao.waitForURL("/settings");
  await expect.poll(() => rao.evaluate(() => document.documentElement.lang)).toBe("hi");
  await rao.goto("/");
  await rao.getByRole("button", { name: "लॉटरी (Hindi)" }).click();
  await rao.getByTestId("check-button").click();
  await rao.waitForURL(/\/stop$/, { waitUntil: "commit" });
  await rao.getByTestId("stop-continue").click();
  await expect(rao.locator("[data-verdict=SCAM]").first()).toHaveText("धोखा");
  await expect(rao.getByRole("button", { name: "अब क्या करें" })).toBeVisible();
});

test("F14 history: a failed load is not an empty list, and search works once the list is there", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  await rao.getByRole("button", { name: "CBI parcel call" }).click();
  await rao.getByTestId("check-button").click();
  await rao.getByTestId("stop-continue").click();
  await rao.goto("/");
  await rao.getByRole("button", { name: "Real bank alert" }).click();
  await rao.getByTestId("check-button").click();
  await expect(rao.getByRole("heading", { name: "This looks like a normal bank message." })).toBeVisible();

  // F14b: the list cannot load → it says so, instead of "No checks yet".
  await rao.route("**/api/me/checks", (r) => r.abort());
  await rao.goto("/history");
  await expect(rao.getByText("We could not load your history")).toBeVisible();
  await expect(rao.getByText("No checks yet")).toHaveCount(0);
  await rao.unroute("**/api/me/checks");
  await rao.getByRole("button", { name: "Try again" }).click();

  // F14c: search and filters.
  await expect(rao.getByText("CBI parcel message")).toBeVisible();
  await rao.getByRole("textbox", { name: "Search checks" }).fill("bank");
  await expect(rao.getByText("Bank debit alert")).toBeVisible();
  await expect(rao.getByText("CBI parcel message")).toHaveCount(0);
  await rao.getByRole("textbox", { name: "Search checks" }).fill("");
  await rao.getByRole("button", { name: "Scams" }).click();
  await expect(rao.getByText("CBI parcel message")).toBeVisible();
  await expect(rao.getByText("Bank debit alert")).toHaveCount(0);
});

test("suspicious: Mr Rao asks; Arjun says fine, it waits for Meera; both fine → not a scam", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  const arjun = await phone(browser, "Arjun");
  const meera = await phone(browser, "Meera");

  await rao.getByRole("button", { name: "Courier fee" }).click();
  await rao.getByRole("button", { name: "Check this message" }).click();
  await expect(rao.getByRole("heading", { name: "Be careful. Ask Arjun before you pay." })).toBeVisible();
  await rao.getByRole("button", { name: "Ask Arjun" }).click();
  await expect(rao.getByText("Waiting for Arjun and Meera…")).toBeVisible();

  await openAlert(arjun, "Is this message safe?");
  await expect(arjun.getByTestId("victim-message")).toContainText("your parcel has reached the customs counter");
  await arjun.getByRole("button", { name: "This is not a scam" }).click();

  // One "fine" is not enough: Papa still sees SUSPICIOUS and who we wait for.
  await expect(rao.getByText("Arjun: not a scam")).toBeVisible({ timeout: 10_000 });
  await expect(rao.getByText("Waiting for Meera…")).toBeVisible();
  await expect(rao.getByRole("heading", { name: "Be careful. Ask Arjun before you pay." })).toBeVisible();

  await openAlert(meera, "Is this message safe?");
  await expect(meera.getByText("Arjun: not a scam")).toBeVisible();
  await meera.getByRole("button", { name: "This is not a scam" }).click();

  await expect(rao.getByRole("heading", { name: "Arjun and Meera checked it. It is not a scam." })).toBeVisible({ timeout: 10_000 });
  await rao.getByRole("button", { name: "Done" }).click();
  await expect(rao.getByText("Something worrying you? Start here.")).toBeVisible();
});

test("one scam settles it: Arjun says fine, Meera says scam → SCAM", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  const arjun = await phone(browser, "Arjun");
  const meera = await phone(browser, "Meera");

  await rao.getByRole("button", { name: "Courier fee" }).click();
  await rao.getByRole("button", { name: "Check this message" }).click();
  await rao.getByRole("button", { name: "Ask Arjun" }).click();

  await openAlert(arjun, "Is this message safe?");
  await arjun.getByRole("button", { name: "This is not a scam" }).click();
  await openAlert(meera, "Is this message safe?");
  await meera.getByRole("button", { name: "It's a scam" }).click();

  await expect(rao.getByRole("heading", { name: "Meera says this is a scam." })).toBeVisible({ timeout: 10_000 });
});

test("family clears a SCAM only when both say so: then Papa's screen no longer says scam", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  const arjun = await phone(browser, "Arjun");
  const meera = await phone(browser, "Meera");

  await rao.getByRole("button", { name: "Bank KYC link" }).click();
  await rao.getByRole("button", { name: "Check this message" }).click();
  await rao.getByRole("button", { name: "I will not do anything" }).click();
  await expect(rao.getByRole("heading", { name: "Do not tap the link." })).toBeVisible();

  await expect(arjun.getByRole("heading", { name: "Papa got a scam message" })).toBeVisible({ timeout: 10_000 });
  await arjun.getByRole("button", { name: "Open", exact: true }).click();
  await expect(arjun.getByTestId("victim-message")).toContainText("sbi-kyc-verify.in");
  // Clearing something the app called SCAM needs a second confirm.
  await arjun.getByRole("button", { name: "This is not a scam" }).click();
  await arjun.getByRole("button", { name: "Yes, it is not a scam" }).click();

  // Still a scam on Papa's phone until Meera agrees.
  await expect(rao.getByText("Waiting for Meera…")).toBeVisible({ timeout: 10_000 });
  await expect(rao.getByRole("heading", { name: "Do not tap the link." })).toBeVisible();

  await openAlert(meera, "Papa got a scam message");
  await meera.getByRole("button", { name: "This is not a scam" }).click();
  await meera.getByRole("button", { name: "Yes, it is not a scam" }).click();

  await expect(rao.getByRole("heading", { name: "Arjun and Meera checked it. It is not a scam." })).toBeVisible({ timeout: 10_000 });
  await expect(rao.getByText("CHECKED BY ARJUN AND MEERA")).toBeVisible();
  await expect(rao.getByRole("heading", { name: "Do not tap the link." })).toHaveCount(0);
});

test("a paused payment is released only when Arjun and Meera both approve", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  const arjun = await phone(browser, "Arjun");
  const meera = await phone(browser, "Meera");

  await rao.getByRole("button", { name: "CBI parcel call" }).click();
  await rao.getByRole("button", { name: "Check this message" }).click();
  await rao.getByRole("button", { name: "I will not do anything" }).click();
  await rao.getByRole("link", { name: /payment paused/ }).click();
  // F13: two keys on Papa's screen too, with the hour-long ring.
  await expect(rao.getByTestId("two-keys")).toBeVisible();

  await openAlert(arjun, "Papa got a scam message");
  await arjun.getByRole("button", { name: /^Approve/ }).click();
  await expect(arjun.getByText("Meera must approve too before the money moves.", { exact: false })).toBeVisible();
  await arjun.getByRole("button", { name: "Yes, approve" }).click();
  await expect(arjun.getByText("You approved. Release needs Meera too.")).toBeVisible();
  await expect(rao.getByText("Arjun approved.")).toBeVisible({ timeout: 10_000 });

  await openAlert(meera, "Papa got a scam message");
  await meera.getByRole("button", { name: /^Approve/ }).click();
  await meera.getByRole("button", { name: "Yes, approve" }).click();
  await expect(meera.getByRole("heading", { name: "Everyone approved it" })).toBeVisible();
  await expect(rao.getByRole("heading", { name: "Arjun and Meera approved this payment" })).toBeVisible({ timeout: 10_000 });
});

test("Arjun protects two people: Mummy's scam is told apart from Papa's", async ({ browser }) => {
  const mom = await phone(browser, "Mrs Rao");
  const arjun = await phone(browser, "Arjun");

  // The family home lists both parents.
  await expect(arjun.getByRole("heading", { name: "Who you protect" })).toBeVisible();
  await expect(arjun.getByText("Papa is protected")).toBeVisible();
  await expect(arjun.getByText("Mummy is protected")).toBeVisible();

  await mom.getByRole("button", { name: "CBI parcel call" }).click();
  await mom.getByRole("button", { name: "Check this message" }).click();
  await expect(mom.getByRole("heading", { name: "STOP" })).toBeVisible();

  await openAlert(arjun, "Mummy got a scam message");
  await expect(arjun.getByRole("heading", { name: "Mummy's payment" })).toBeVisible();
  await expect(arjun.getByTestId("victim-message")).toContainText("Mummy pasted it into Pause Button");
  await arjun.getByTestId("block").click();
  await expect(arjun.getByRole("heading", { name: "You blocked it" })).toBeVisible();
  await arjun.getByRole("button", { name: "Back to home" }).click();

  // Back on the list: Mummy's card shows her latest check, Papa's is untouched.
  await expect(arjun.getByText("Mummy is protected")).toBeVisible({ timeout: 10_000 });
  await arjun.getByTestId(/person-/).filter({ hasText: "Mummy" }).click();
  // Her "Today" card. (The ledger's "… checked · … were fine" line is on this screen and
  // on the list, which the router keeps mounted but hidden, so match the whole text.)
  await expect(arjun.getByText(/^\d+ messages? checked$/)).toBeVisible();
  await expect(mom.getByRole("heading", { name: "Payment cancelled" })).toBeVisible({ timeout: 10_000 });
});

test("a family phone registers the service worker that shows alerts when the app is closed", async ({ browser }) => {
  const ctx = await newContext(browser, { permissions: ["notifications"] });
  const page = await ctx.newPage();
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Continue as Meera (demo)" }).click();
  await page.waitForURL("/family");
  await page.goto("/family/alerts-setup");
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForURL("/family");
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return { scope: new URL(reg.scope).pathname, script: new URL(reg.active!.scriptURL).pathname };
  });
  expect(sw).toEqual({ scope: "/", script: "/sw.js" });
  expect((await page.request.get("/sw.js")).status()).toBe(200);
});

test("safe: a real bank alert needs nobody", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  await rao.getByRole("button", { name: "Real bank alert" }).click();
  await rao.getByRole("button", { name: "Check this message" }).click();
  await expect(rao.getByRole("heading", { name: "This looks like a normal bank message." })).toBeVisible();
});

test("on a laptop, Call shows the number instead of dialing", async ({ browser }) => {
  const page = await (await newContext(browser, { ...devices["Desktop Chrome"] })).newPage();
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Continue as Mr Rao (demo)" }).click();
  await page.waitForURL("/");
  await page.getByRole("button", { name: "CBI parcel call" }).click();
  await page.getByTestId("check-button").click();
  await page.waitForURL(/\/stop$/);
  await page.getByRole("button", { name: "Call Arjun" }).click();
  await expect(page.getByText(/^Call Arjun: \+91 \d{5} \d{5}$/)).toBeVisible();
});

test("push notification tap: /open/<alert> lands on the paused payment, with the app closed or signed out", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  const arjun = await phone(browser, "Arjun");
  const meera = await phone(browser, "Meera");
  await rao.getByRole("button", { name: "CBI parcel call" }).click();
  await rao.getByTestId("check-button").click();
  await rao.getByTestId("stop-continue").click();
  await expect(arjun.getByRole("heading", { name: "Papa got a scam message" })).toBeVisible({ timeout: 10_000 });

  // What the push payload carries: each phone's own alert id.
  type State = { alerts: { id: string; kind: string; holdId: string | null }[] };
  const mine = ((await (await arjun.request.get("/api/family/state")).json()) as State).alerts.find((a) => a.kind === "urgent")!;
  const hers = ((await (await meera.request.get("/api/family/state")).json()) as State).alerts.find((a) => a.kind === "urgent")!;
  expect(mine.holdId).toBeTruthy();

  // The app was in the background or closed: the tap opens a fresh page straight on the payment, not the home screen.
  const tapped = await arjun.context().newPage();
  await tapped.goto(`/open/${mine.id}`);
  await tapped.waitForURL(`/family/hold/${mine.holdId}`);
  await expect(tapped.getByText("Rs 80,000 paused")).toBeVisible();

  // Someone else's alert never opens on this phone.
  await tapped.goto(`/open/${hers.id}`);
  await tapped.waitForURL("/family");

  // A signed-out phone keeps the destination through the welcome and sign-in screens.
  const fresh = await (await newContext(browser)).newPage();
  await fresh.goto(`/open/${mine.id}`);
  await fresh.waitForURL("/welcome");
  await fresh.getByRole("button", { name: "Get started" }).click();
  await fresh.getByRole("button", { name: "Continue as Arjun (demo)" }).click();
  await fresh.waitForURL(`/family/hold/${mine.holdId}`, { timeout: 15_000 });
  await expect(fresh.getByText("Rs 80,000 paused")).toBeVisible();

  // Mr Rao's own phone has the Notifications setting, in his language.
  await rao.goto("/settings");
  await expect(rao.getByTestId("notify-row")).toContainText("Notifications");
  await expect(rao.getByRole("switch", { name: "Notifications" })).toBeVisible();
});

test("scam with no amount: it stays on Arjun's home until he answers", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  const arjun = await phone(browser, "Arjun");

  await rao.getByRole("button", { name: "Bank KYC link" }).click();
  await rao.getByRole("button", { name: "Check this message" }).click();
  await expect(rao.getByRole("heading", { name: "STOP" })).toBeVisible();

  await openAlert(arjun, "Papa got a scam message");
  await expect(arjun.getByRole("heading", { name: "Scam alert" })).toBeVisible();

  // He goes back without answering: Papa's card and Papa's page still show it.
  await arjun.goto("/family");
  const papa = arjun.getByTestId(/person-/).filter({ hasText: "Papa" });
  await expect(papa).toContainText("1 message to look at");
  await papa.click();
  await expect(arjun.getByText("Papa got a scam message")).toBeVisible();
  await expect(arjun.getByText("Papa is protected")).toHaveCount(0);
});

test("the evidence screen shows no percentages", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  await rao.getByRole("button", { name: "CBI parcel call" }).click();
  await rao.getByRole("button", { name: "Check this message" }).click();
  await rao.getByRole("button", { name: "I will not do anything" }).click();
  await rao.getByRole("button", { name: "Why we think so" }).click();
  await expect(rao.getByRole("heading", { name: "Why we think so" })).toBeVisible();
  await expect(rao.getByText(/\d\s?%/)).toHaveCount(0);
});

test("removing the last linked person warns that nobody will be told", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  await rao.goto("/setup");
  await rao.getByRole("button", { name: "Remove Meera" }).click();
  await expect(rao.getByText("Nobody will be told")).toHaveCount(0);
  await rao.getByRole("button", { name: "Yes, remove Meera" }).click();
  await rao.getByRole("button", { name: "Remove Arjun" }).click();
  await expect(rao.getByText("Nobody will be told")).toBeVisible();
});

// ---------- Push in a real browser (W3) ----------
// Chromium's own service worker runs public/sw.js, receives the alert
// (delivered through DevTools, the way the push service would hand it over),
// shows it, and confirms it to the server. The protocol side (encryption,
// VAPID, the push service's answers) is src/lib/server/push.protocol.test.ts;
// real phones are in docs/push.md.

const cbi = examples.find((e) => e.id === "cbi")!.text;

/**
 * A browser that can show notifications. Playwright's default headless
 * Chromium is the "headless shell", which has none: Notification.permission
 * stays "denied" whatever is granted, so showNotification throws. Channel
 * "chromium" runs the full build headless (CI installs both); a Chromium set
 * with executablePath in the config is used as it is.
 */
async function browserWithNotifications() {
  const options = test.info().project.use.launchOptions ?? {};
  const b = await chromium.launch({ ...options, headless: !HEADED, ...(options.executablePath ? {} : { channel: "chromium" }) });
  browsers.push(b);
  return b;
}

test("a real service worker shows the alert, confirms it, and its tap target opens the paused payment", async ({ browser, baseURL }) => {
  // Mr Rao pastes the CBI scam: the payment is paused and Arjun gets an urgent alert.
  const raoCtx = await newContext(browser);
  await raoCtx.request.post("/api/auth/demo", { data: { persona: "rao" } });
  const check = await (await raoCtx.request.post("/api/me/checks", { data: { text: cbi } })).json();
  expect(check.holdId).toBeTruthy();

  // Arjun's phone, in a browser that can show notifications: signed in, the service worker installed, notifications allowed.
  const ctx = await (await browserWithNotifications()).newContext({ baseURL });
  await ctx.grantPermissions(["notifications"], { origin: baseURL });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const registrations: { registrationId: string; scopeURL: string; isDeleted: boolean }[] = [];
  cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => registrations.push(...e.registrations));
  await cdp.send("ServiceWorker.enable");
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Continue as Arjun (demo)" }).click();
  await page.waitForURL("/family");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const alert = ((await (await page.request.get("/api/family/state")).json()).alerts as { id: string; checkId: string }[]).find((a) => a.checkId === check.checkId)!;
  expect(alert).toBeTruthy();

  // The app closed (a page outside it is open): only the service worker can show the alert.
  await page.goto("/download");
  await expect.poll(() => registrations.find((r) => !r.isDeleted && r.scopeURL === `${baseURL}/`)?.registrationId).toBeTruthy();
  const registrationId = registrations.find((r) => !r.isDeleted && r.scopeURL === `${baseURL}/`)!.registrationId;

  // The payload as the server builds it (sendAlerts in checks.ts), with this phone's delivery id.
  const payload = {
    title: "Papa needs you now",
    body: "Papa got a scam message asking for Rs 80,000. Nothing is paid. Tell Papa what to do.",
    url: `/open/${alert.id}`,
    tag: `alert-${alert.id}`,
    urgent: true,
    kind: "urgent",
    alertId: alert.id,
    checkId: check.checkId,
    holdId: check.holdId,
    actions: [{ action: "block", title: "Block payment" }, { action: "fine", title: "It's fine" }],
    who: "Papa",
    at: new Date().toISOString(),
    receipt: crypto.randomUUID(),
  };
  const receipt = ctx.waitForEvent("request", (r) => r.url().endsWith("/api/push/receipt"));
  await cdp.send("ServiceWorker.deliverPushMessage", { origin: baseURL!, registrationId, data: JSON.stringify(payload) });

  // The service worker confirms it, and the server accepts the receipt.
  const sent = await receipt;
  expect(sent.postDataJSON()).toEqual({ id: payload.receipt, shown: true, error: null });
  expect((await sent.response())?.status()).toBe(200);

  // The notification is on screen: urgent, with Block built in, and the screen a tap opens.
  const shown = await page.evaluate(async () =>
    (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({
      title: n.title,
      tag: n.tag,
      requireInteraction: n.requireInteraction,
      actions: (n as Notification & { actions?: { action: string }[] }).actions?.map((a) => a.action) ?? [],
      url: (n.data as { url: string }).url,
    })),
  );
  expect(shown).toEqual([{ title: payload.title, tag: payload.tag, requireInteraction: true, actions: ["block", "fine"], url: `/open/${alert.id}` }]);

  // A tap opens that URL: the paused payment, on Arjun's phone.
  await page.goto(shown[0].url);
  await expect(page.getByRole("heading", { name: "Papa's payment" })).toBeVisible();

});

test("nobody's phone can be reached: after 30 s Papa's verdict and his paused payment both say so", async ({ browser }) => {
  test.setTimeout(120_000);
  // No family phone is open and none has push set up.
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Continue as Mr Rao (demo)" }).click();
  await page.waitForURL("/");
  const check = await (await page.request.post("/api/me/checks", { data: { text: cbi } })).json();

  await page.goto(`/check/${check.checkId}`);
  await expect(page.getByTestId("nobody-reached")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("nobody-reached")).toContainText("Nobody has seen this yet");
  await expect(page.getByTestId("nobody-reached").getByRole("button", { name: "Call Arjun" })).toBeVisible();

  await page.goto(`/hold/${check.holdId}`);
  await expect(page.getByTestId("nobody-reached")).toContainText("The alert has not reached Arjun and Meera.");
});

test("Delete my account: a shared demo account cannot be deleted; a real one can, and is signed out", async ({ browser }) => {
  const demo = await phone(browser, "Mr Rao");
  await demo.goto("/privacy");
  await expect(demo.getByText("This is a shared demo account, so it cannot be deleted.")).toBeVisible();
  await expect(demo.getByTestId("delete-account")).toHaveCount(0);
  // The same promise the policy makes (docs/retention.md): 24 hours, and the log.
  await expect(demo.getByText(/for 24 hours/).first()).toBeVisible();
  await expect(demo.getByText(/for 30 days/)).toBeVisible();

  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const phoneNumber = `9${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;
  const sent = await ctx.request.post("/api/auth/code", { data: { phone: phoneNumber } });
  expect(sent.ok(), await sent.text()).toBeTruthy();
  const { demoCode } = (await sent.json()) as { demoCode: string };
  expect((await ctx.request.post("/api/auth/sign-in", { data: { phone: phoneNumber, code: demoCode } })).ok()).toBeTruthy();
  expect((await ctx.request.post("/api/auth/role", { data: { role: "protected", name: "Test Person" } })).ok()).toBeTruthy();
  await page.goto("/privacy");
  await page.getByTestId("delete-account").click();
  await expect(page.getByRole("heading", { name: "Delete your account?" })).toBeVisible();
  await page.getByTestId("confirm-delete-account").click();
  await page.waitForURL("**/welcome");
  expect((await ctx.request.get("/api/me/state")).status()).toBe(401);
});
