import { defineConfig, devices } from "@playwright/test";

// Three-phone end-to-end test (Mr Rao, Arjun, Meera) against a fresh in-memory database.
//   pnpm e2e          headless (CI); run `pnpm build` first
//   pnpm e2e:headed   builds, then opens the three phones as visible windows, slowed down
const PORT = 3300;
const HEADED = !!process.env.HEADED;

export default defineConfig({
  testDir: "e2e",
  timeout: HEADED ? 180_000 : 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: HEADED ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["Pixel 7"],
    // A phone-sized window that fits on a laptop screen next to the second phone.
    ...(HEADED ? { viewport: { width: 390, height: 760 } } : {}),
    headless: !HEADED,
    launchOptions: { slowMo: HEADED ? 450 : 0 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}/welcome`,
    env: { PGLITE_DIR: "memory" },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
