import { expect, test } from "@playwright/test";

// The page the shared QR code opens, and the QR itself.

test("the download page offers the Android app and shows a QR for itself", async ({ page, request }) => {
  await page.goto("/download");
  await expect(page.getByRole("heading", { name: "Get Pause Button" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download for Android" })).toHaveAttribute("href", "/pause-button.apk");
  await expect(page.getByRole("img", { name: "QR code for this page" })).toBeVisible();

  const qr = await request.get("/download/qr", { headers: { "x-forwarded-host": "example.up.railway.app", "x-forwarded-proto": "https" } });
  expect(qr.status()).toBe(200);
  expect(qr.headers()["content-type"]).toContain("image/svg+xml");
  expect(await qr.text()).toContain("<svg");
});

test("the health check answers", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
