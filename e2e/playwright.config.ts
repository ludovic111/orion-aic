import { defineConfig, devices } from "@playwright/test";

// End-to-end tests: the production build served by the production server
// (static files + WebSocket relay), driven in Chromium. Run with
// `npm run e2e`. The build runs first unless E2E_SKIP_BUILD is set (the CI
// sets it: its previous step has just built dist/).
const port = Number(process.env.E2E_PORT || 4390);
const baseURL = `http://127.0.0.1:${port}`;
const serve = `node server/index.mjs`;

export default defineConfig({
  testDir: ".",
  outputDir: "../test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "../playwright-report", open: "never" }],
  ],
  use: {
    baseURL,
    locale: "fr-CH",
    timezoneId: "Europe/Zurich",
    // The service worker would cache the shell between tests and fetch in
    // the background: blocked, every test starts from the network.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /phone\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1360, height: 900 },
      },
    },
    {
      name: "phone",
      testMatch: /phone\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: process.env.E2E_SKIP_BUILD ? serve : `npm run build && ${serve}`,
    cwd: "..",
    url: baseURL,
    env: { PORT: String(port), HOST: "127.0.0.1" },
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
