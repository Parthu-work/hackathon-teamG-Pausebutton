import { expect, test, type Browser, type Page } from "@playwright/test";

// Mr Rao and Arjun on two "phones" (two browser contexts), one service.

async function phone(browser: Browser, persona: "Mr Rao" | "Arjun"): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/sign-in");
  await page.getByRole("button", { name: `Continue as ${persona} (demo)` }).click();
  await page.waitForURL(persona === "Mr Rao" ? "/" : "/family");
  return page;
}

test.beforeEach(async ({ request }) => {
  await request.post("/api/demo/reset");
});

test("scam: STOP, payment held, Arjun blocks, Mr Rao sees it cancelled", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  const arjun = await phone(browser, "Arjun");

  await rao.getByRole("button", { name: "CBI parcel call" }).click();
  await rao.getByRole("button", { name: "Check this message" }).click();
  await expect(rao.getByRole("heading", { name: "STOP" })).toBeVisible();
  await rao.getByRole("button", { name: "I will not do anything" }).click();
  await expect(rao.getByRole("heading", { name: "Do not pay. Hang up." })).toBeVisible();
  await expect(rao.getByText("Arjun and Meera were alerted")).toBeVisible();

  // Arjun's phone polls, buzzes and opens the alert by itself.
  await expect(arjun.getByRole("heading", { name: "Papa got a scam message" })).toBeVisible({ timeout: 10_000 });
  await arjun.getByRole("button", { name: "Open" }).click();
  await expect(arjun.getByText("Rs 80,000 paused")).toBeVisible();

  // Approve needs a second confirm; he keeps it blocked, sends advice, then blocks.
  await arjun.getByRole("button", { name: "Approve (I know this payment)" }).click();
  await arjun.getByRole("button", { name: "No, keep it blocked" }).click();
  await arjun.getByRole("button", { name: /Send advice and call Papa/ }).click();
  await arjun.getByRole("button", { name: "Block this payment" }).click();
  await expect(arjun.getByRole("heading", { name: "You blocked it" })).toBeVisible();

  // Mr Rao's phone jumps to the outcome on its next poll.
  await expect(rao.getByRole("heading", { name: "Payment cancelled" })).toBeVisible({ timeout: 10_000 });
  await expect(rao.getByText("Arjun blocked it.")).toBeVisible();
  await expect(rao.getByText("“Hang up. Do not pay or click anything.”")).toBeVisible();
});

test("suspicious: Mr Rao asks Arjun, Arjun says it is not a scam", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  const arjun = await phone(browser, "Arjun");

  await rao.getByRole("button", { name: "Courier fee" }).click();
  await rao.getByRole("button", { name: "Check this message" }).click();
  await expect(rao.getByRole("heading", { name: "Be careful. Ask Arjun before you pay." })).toBeVisible();
  await rao.getByRole("button", { name: "Ask Arjun" }).click();
  await expect(rao.getByText("Waiting for Arjun…")).toBeVisible();

  await expect(arjun.getByRole("heading", { name: "Is this message safe?" })).toBeVisible({ timeout: 10_000 });
  await arjun.getByRole("button", { name: "Open" }).click();
  await arjun.getByRole("button", { name: "This is not a scam" }).click();

  await expect(rao.getByText("This is not a scam. You can carry on.")).toBeVisible({ timeout: 10_000 });
  await rao.getByRole("button", { name: "Done" }).click();
  await expect(rao.getByRole("heading", { name: "Got a worrying message?" })).toBeVisible();
});

test("safe: a real bank alert needs nobody", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");
  await rao.getByRole("button", { name: "Real bank alert" }).click();
  await rao.getByRole("button", { name: "Check this message" }).click();
  await expect(rao.getByRole("heading", { name: "This looks like a normal bank message." })).toBeVisible();
});
