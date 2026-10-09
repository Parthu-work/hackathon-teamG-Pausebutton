import { devices, expect, test, type Browser, type Page } from "@playwright/test";

// Mr Rao, Arjun and Meera on three "phones" (browser contexts), one service.
// One "scam" (or Block) from either trusted person settles it; "not a scam"
// (or Approve) needs both of them.

const HEADED = !!process.env.HEADED;

/** Taps a "Call …" button and returns the number the phone's dialer was opened with. */
async function dialedNumber(page: Page, button: string | RegExp) {
  const dial = page.waitForRequest((r) => r.url().startsWith("tel:"));
  await page.getByRole("button", { name: button }).click();
  return (await dial).url();
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
  const page = await (await browser.newContext()).newPage();
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

  // Approve needs a second confirm; he keeps it blocked, sends advice, then blocks.
  await arjun.getByRole("button", { name: "Approve (I know this payment)" }).click();
  await arjun.getByRole("button", { name: "No, keep it blocked" }).click();
  // Sends the advice and opens the dialer with Papa's number.
  expect(await dialedNumber(arjun, /Send advice and call Papa/)).toMatch(/^tel:\+91\d{10}$/);
  await arjun.getByRole("button", { name: "Block this payment" }).click();
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
  await expect(rao.getByRole("heading", { name: "Got a worrying message?" })).toBeVisible();
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
  await expect(arjun.getByTestId("victim-message")).toContainText("sbi-kyc-update.com");
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

  await openAlert(arjun, "Papa got a scam message");
  await arjun.getByRole("button", { name: "Approve (I know this payment)" }).click();
  await expect(arjun.getByText("Meera must approve too before the money moves.", { exact: false })).toBeVisible();
  await arjun.getByRole("button", { name: "Yes, approve" }).click();
  await expect(arjun.getByText("You approved. Waiting for Meera.")).toBeVisible();
  await expect(rao.getByText("Arjun approved.")).toBeVisible({ timeout: 10_000 });

  await openAlert(meera, "Papa got a scam message");
  await meera.getByRole("button", { name: "Approve (I know this payment)" }).click();
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
  await arjun.getByRole("button", { name: "Block this payment" }).click();
  await expect(arjun.getByRole("heading", { name: "You blocked it" })).toBeVisible();
  await arjun.getByRole("button", { name: "Back to home" }).click();

  // Back on the list: Mummy's card shows her latest check, Papa's is untouched.
  await expect(arjun.getByText("Mummy is protected")).toBeVisible({ timeout: 10_000 });
  await arjun.getByTestId(/person-/).filter({ hasText: "Mummy" }).click();
  await expect(arjun.getByText(/\d+ messages? checked/)).toBeVisible();
  await expect(mom.getByRole("heading", { name: "Payment cancelled" })).toBeVisible({ timeout: 10_000 });
});

test("a family phone registers the service worker that shows alerts when the app is closed", async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ["notifications"] });
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
  const page = await (await browser.newContext({ ...devices["Desktop Chrome"] })).newPage();
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Continue as Mr Rao (demo)" }).click();
  await page.waitForURL("/");
  await page.getByRole("button", { name: "CBI parcel call" }).click();
  await page.getByRole("button", { name: "Check this message" }).click();
  await page.waitForURL(/\/stop$/);
  await page.getByRole("button", { name: "Call Arjun" }).click();
  await expect(page.getByText(/^Call Arjun: \+91 \d{5} \d{5}$/)).toBeVisible();
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
