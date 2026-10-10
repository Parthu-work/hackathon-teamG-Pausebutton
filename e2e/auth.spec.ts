import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// A1/A2 sign-in on a phone: the number, the 4-digit code shown on screen once
// (demo mode), the name asked at sign-up, the greeting by that name, and what
// Back and a reload do afterwards.
//
// Every test signs up numbers of its own, never a demo persona: the browser
// tests in family-phones.spec.ts run alongside, and a demo persona's page
// left polling here would see (and use up) their alerts and payment outcomes.
// Each phone is also on a network of its own (x-real-ip), as real phones are,
// so the per-address sign-in limits do not add up across tests.

const newNumber = () => `9${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;
const ownNetwork = (context: BrowserContext) =>
  context.setExtraHTTPHeaders({ "x-real-ip": `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250)).join(".")}` });

/** Welcome → Get started → the number → Send code. Returns the code the screen shows. */
async function askCode(page: Page, number: string) {
  await page.goto("/welcome");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.waitForURL("/sign-in");
  await page.getByLabel("Mobile number").fill(number);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.waitForURL(/\/sign-in\?step=code$/);
  const shown = page.getByTestId("demo-code");
  await expect(shown).toContainText(/Your code:\s*\d \d \d \d/);
  return (await shown.textContent())!.replace(/\D/g, "");
}

async function typeCode(page: Page, code: string) {
  for (let i = 0; i < code.length; i++) await page.getByLabel(`Code digit ${i + 1}`).fill(code[i]);
}

/** A sign-in button left disabled by a sign-in that already went through (the bug this guards). */
const disabledSignIn = (page: Page) => page.getByRole("button", { name: /^(Sign in|Send code|Continue as .+)$/, disabled: true });

/** Signs a new number up through the API, as Mr Rao's phone. */
async function signUpByApi(context: BrowserContext, number: string, role: "protected" | "family", name: string) {
  const sent = await context.request.post("/api/auth/code", { data: { phone: number } });
  expect(sent.ok(), await sent.text()).toBeTruthy();
  const { demoCode } = (await sent.json()) as { demoCode: string };
  const signedIn = await context.request.post("/api/auth/sign-in", { data: { phone: number, code: demoCode } });
  expect(await signedIn.json()).toEqual({ redirect: "/role" });
  expect((await context.request.post("/api/auth/role", { data: { role, name } })).ok()).toBeTruthy();
}

test.beforeEach(async ({ context }) => {
  await ownNetwork(context);
});

test("a new number signs up: the code on screen, a name required, and home greets him by it, also after Back and a reload", async ({ page }) => {
  const code = await askCode(page, newNumber());
  await expect(page.getByTestId("code-expiry")).toContainText(/works for 0[45]:\d\d more/);
  await expect(page.getByRole("button", { name: /^Resend code in \d+ s$/ })).toBeDisabled();
  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  await expect(signIn).toBeDisabled(); // until all four digits are in
  await typeCode(page, code);
  await signIn.click();
  await page.waitForURL("/role");

  // No name, no way on.
  const go = page.getByRole("button", { name: "Continue" });
  await expect(page.getByLabel("Your name")).toHaveValue("");
  await expect(go).toBeDisabled();
  await page.getByLabel("Your name").press("Enter");
  await expect(page.getByText("Please enter your name.")).toBeVisible();
  await expect(page).toHaveURL("/role");

  await page.getByLabel("Your name").fill("Ramesh");
  await go.click();
  await page.waitForURL("/setup");

  // Back from the next screen: the sign-in screen it returns to has no button
  // left disabled, and a phone that is signed in by now is sent on home.
  await page.goBack();
  await expect(disabledSignIn(page)).toHaveCount(0);
  await page.waitForURL("/");
  await expect(disabledSignIn(page)).toHaveCount(0);

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toContainText(/^Good (morning|afternoon|evening), Ramesh$/);
  await page.reload();
  await expect(heading).toContainText(/^Good (morning|afternoon|evening), Ramesh$/);

  // Opening the sign-in screens while signed in lands on his home.
  await page.goto("/sign-in");
  await page.waitForURL("/");
  await page.goto("/welcome");
  await page.waitForURL("/");
});

test("the code is shown once: Back to the number and a reload do not bring it back", async ({ page }) => {
  const number = newNumber();
  await askCode(page, number);
  // The phone's Back returns to the number, and the code is gone.
  await page.goBack();
  await expect(page).toHaveURL("/sign-in");
  await expect(page.getByRole("button", { name: "Send code" })).toBeEnabled();
  await expect(page.getByTestId("demo-code")).toHaveCount(0);
  await page.goForward();
  await expect(page.getByTestId("demo-code")).toHaveCount(0);
  // Asking again at once: it says how long to wait, not a new code.
  await page.goto("/sign-in");
  await page.getByLabel("Mobile number").fill(number);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText(/^Please wait \d+ seconds before asking for a new code\.$/)).toBeVisible();
  await expect(page.getByTestId("demo-code")).toHaveCount(0);

  // A reload on the code step starts again at the number.
  await askCode(page, newNumber());
  await page.reload();
  await expect(page.getByRole("button", { name: "Send code" })).toBeEnabled();
  await expect(page).toHaveURL("/sign-in");
  await expect(page.getByTestId("demo-code")).toHaveCount(0);
});

test("Resend: after 30 s a new code, and the old one stops working", async ({ page }) => {
  test.setTimeout(100_000);
  const first = await askCode(page, newNumber());
  const resend = page.getByRole("button", { name: /^Resend code/ });
  await expect(resend).toBeDisabled();
  await expect(resend).toHaveText("Resend code", { timeout: 40_000 });
  await resend.click();
  // A new code: the wait starts again.
  await expect(page.getByRole("button", { name: /^Resend code in \d+ s$/ })).toBeDisabled();
  const second = (await page.getByTestId("demo-code").textContent())!.replace(/\D/g, "");
  expect(second).toMatch(/^\d{4}$/);
  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  // (One time in 10,000 the new code has the same digits; then the old digits are simply the new code.)
  if (second !== first) {
    await typeCode(page, first);
    await signIn.click();
    await expect(page.getByText("That code is not right. Please check it and try again.")).toBeVisible();
  }
  await typeCode(page, second);
  await signIn.click();
  await page.waitForURL("/role");
});

test("family invited by name: the name is filled in, the family home greets them by it, and /sign-in leads home", async ({ browser, page }) => {
  // Mr Rao's phone (signed up through the API) invites Kiran by number.
  const raoContext = await browser.newContext();
  await ownNetwork(raoContext);
  await signUpByApi(raoContext, newNumber(), "protected", "Ramesh Rao");
  const kiranNumber = newNumber();
  const invited = await raoContext.request.post("/api/me/people", { data: { name: "Kiran", relation: "Son", phone: kiranNumber } });
  expect(invited.ok(), await invited.text()).toBeTruthy();
  const { inviteCode } = (await invited.json()) as { inviteCode: string };
  await raoContext.close();

  // Kiran signs up on his own phone: the name box starts with the name he was invited by.
  const code = await askCode(page, kiranNumber);
  await typeCode(page, code);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("/role");
  await expect(page.getByLabel("Your name")).toHaveValue("Kiran");
  await page.getByRole("button", { name: /I protect someone/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL("/family/join");
  expect((await page.request.post("/api/family/join", { data: { code: inviteCode } })).ok()).toBeTruthy();

  await page.goto("/family");
  await expect(page.getByTestId("greeting").filter({ visible: true })).toHaveText(/^Good (morning|afternoon|evening), Kiran$/);
  await page.goto("/sign-in");
  await page.waitForURL("/family");
  await page.goto("/welcome");
  await page.waitForURL("/family");
});

test("invites: Mr Rao can start before anyone joins, and copies an invite that says where to go", async ({ browser }) => {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  await ownNetwork(context);
  await signUpByApi(context, newNumber(), "protected", "Ramesh Rao");
  const invited = await context.request.post("/api/me/people", { data: { name: "Kiran", relation: "Son", phone: newNumber() } });
  expect(invited.ok(), await invited.text()).toBeTruthy();
  const { inviteCode } = (await invited.json()) as { inviteCode: string };

  const page = await context.newPage();
  await page.goto("/setup/invites");
  await page.getByRole("button", { name: "Copy invite" }).click();
  await expect(page.getByText("Invite copied")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(inviteCode);
  expect(copied).toContain(new URL(page.url()).origin);

  // Kiran has not joined yet: starting is still allowed.
  await expect(page.getByText("Your people get alerts once they join.")).toBeVisible();
  await page.getByRole("button", { name: "Start checking messages" }).click();
  await page.waitForURL("/");
  await context.close();
});
