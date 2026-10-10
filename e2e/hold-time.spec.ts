import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import examples from "../src/data/examples.json";

// D2 · Payment hold time: Mr Rao (or Arjun, for Papa) picks 5, 10, 15, 30 or
// 60 minutes in Settings, and the next paused payment counts down that long.

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => {})));
});

async function phone(browser: Browser, persona: "Mr Rao" | "Arjun"): Promise<Page> {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  await page.goto("/sign-in");
  await page.getByRole("button", { name: `Continue as ${persona} (demo)` }).click();
  await page.waitForURL(persona === "Mr Rao" ? "/" : "/family");
  return page;
}

/** "14:58" → 898 seconds. */
const seconds = (label: string) => {
  const [m, s] = label.split(":").map(Number);
  return m * 60 + s;
};

test.beforeEach(async ({ request }) => {
  const r = await request.post("/api/demo/reset");
  expect(r.ok(), await r.text()).toBeTruthy();
});

test("Mr Rao sets 15 minutes in Settings; the next hold counts down from 15:00", async ({ browser }) => {
  const rao = await phone(browser, "Mr Rao");

  await rao.getByRole("link", { name: "Settings" }).click();
  const holdTime = rao.getByTestId("hold-time");
  await expect(holdTime).toContainText("Payment hold time");
  await expect(holdTime.getByRole("button", { name: "10 min" })).toHaveAttribute("aria-pressed", "true");
  await holdTime.getByRole("button", { name: "15 min" }).click();
  await expect(holdTime.getByRole("button", { name: "15 min" })).toHaveAttribute("aria-pressed", "true");
  await expect(holdTime.getByRole("button", { name: "10 min" })).toHaveAttribute("aria-pressed", "false");

  await rao.getByRole("link", { name: "Check", exact: true }).click();
  await rao.getByRole("button", { name: "CBI parcel call" }).click();
  await rao.getByRole("button", { name: "Check this message" }).click();
  await expect(rao.getByRole("heading", { name: "STOP" })).toBeVisible();
  await rao.getByRole("button", { name: "I will not do anything" }).click();
  await rao.getByRole("link", { name: /payment paused/ }).click();

  // The ring shows the time left, and it is counting down.
  const clock = rao.locator(".ring").getByText(/^\d\d:\d\d$/);
  await expect(clock).toHaveText(/^1[45]:\d\d$/);
  const first = seconds(await clock.innerText());
  expect(first).toBeGreaterThan(14 * 60);
  expect(first).toBeLessThanOrEqual(15 * 60);
  await expect.poll(async () => seconds(await clock.innerText()), { timeout: 5_000 }).toBeLessThan(first);
  // Rs 80,000 needs two keys; the card names this hold's own time.
  await expect(rao.getByTestId("two-keys")).toContainText("we hold for 15 minutes");
});

test("Arjun sets Papa's hold time to 30 minutes; Papa's next hold is 30 minutes", async ({ browser }) => {
  const arjun = await phone(browser, "Arjun");
  const rao = await phone(browser, "Mr Rao");

  await arjun.getByRole("link", { name: "Settings" }).click();
  const papa = arjun.getByRole("group", { name: "Papa's payment hold time" });
  await expect(papa.getByRole("button", { name: "10 min" })).toHaveAttribute("aria-pressed", "true");
  await papa.getByRole("button", { name: "30 min" }).click();
  await expect(arjun.getByText("Papa's hold time is 30 minutes")).toBeVisible();
  await expect(papa.getByRole("button", { name: "30 min" })).toHaveAttribute("aria-pressed", "true");
  // Mummy's is her own setting.
  await expect(arjun.getByRole("group", { name: "Mummy's payment hold time" }).getByRole("button", { name: "10 min" })).toHaveAttribute("aria-pressed", "true");

  // Papa's own Settings shows the change.
  await rao.getByRole("link", { name: "Settings" }).click();
  await expect(rao.getByTestId("hold-time").getByRole("button", { name: "30 min" })).toHaveAttribute("aria-pressed", "true");

  // A new hold for Papa is 30 minutes long.
  const cbi = examples.find((e) => e.id === "cbi")!.text;
  const res = await rao.request.post("/api/me/checks", { data: { text: cbi } });
  expect(res.ok(), await res.text()).toBeTruthy();
  const { holdId } = (await res.json()) as { holdId: string };
  const { hold } = (await (await rao.request.get(`/api/me/holds/${holdId}`)).json()) as { hold: { holdMinutes: number; createdAt: string; expiresAt: string } };
  expect(hold.holdMinutes).toBe(30);
  expect(new Date(hold.expiresAt).getTime() - new Date(hold.createdAt).getTime()).toBe(30 * 60_000);

  // Arjun's phone counts down the same 30 minutes.
  await arjun.goto(`/family/hold/${holdId}`);
  await expect(arjun.getByRole("heading", { name: "Papa's payment" })).toBeVisible();
  const left = arjun.getByText(/^\d\d:\d\d left$/);
  await expect(left).toHaveText(/^(30:00|29:\d\d) left$/);
  const first = seconds((await left.innerText()).replace(" left", ""));
  await expect.poll(async () => seconds((await left.innerText()).replace(" left", "")), { timeout: 5_000 }).toBeLessThan(first);
  await expect(arjun.getByTestId("two-keys")).toContainText("we hold for 30 minutes");
});
