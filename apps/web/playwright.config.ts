// Headless Chromium only, as govhub. Playwright builds the app and serves it with `vite preview` (the CSP is only in the built
// index.html), then stops it. CAIRN_E2E_PORT lets parallel checkouts run side by side.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.CAIRN_E2E_PORT ?? 4417);
const LIVE = Object.keys(process.env).some((k) => k.startsWith('CAIRN_LIVE') && process.env[k]);

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  // the smoke suite reads testnet Platform; one retry absorbs a slow node in CI
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: [['list']],
  // live specs spend real tDASH and type real phrases: only when asked, and never with traces (a failed run would keep them)
  grepInvert: LIVE ? undefined : /@live/,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    trace: LIVE ? 'off' : 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], headless: true } }],
  webServer: {
    command: `npx vite build --logLevel warn && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
