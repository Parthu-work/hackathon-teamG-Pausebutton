import { defineConfig, devices } from "@playwright/test";

// Two-phone end-to-end test. Run `pnpm build` first (CI does), then `pnpm e2e`.
// The server uses an in-memory database, so every run starts clean.
const PORT = 3300;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, ...devices["Pixel 7"], trace: "retain-on-failure" },
  webServer: {
    command: `pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}/welcome`,
    env: { PGLITE_DIR: "memory" },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
