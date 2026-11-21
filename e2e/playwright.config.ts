import { defineConfig, devices } from '@playwright/test';
import { appUrl, ingressUrl } from './env';

/**
 * TR-06 / TR-07: E2E against a fresh docker compose stack (see global-setup.ts) on a phone
 * viewport, on desktop, and on desktop behind an ingress-like base path.
 *
 *   npm run test:e2e                 – build, start, test, tear down
 *   E2E_REUSE=1 npm run test:e2e     – use an already running e2e stack
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  // One shared database: run tests one after another.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile',
      // iPhone 13 viewport, touch and user agent; rendered with Chromium to keep CI light.
      use: { ...devices['iPhone 13'], browserName: 'chromium', baseURL: appUrl },
    },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], baseURL: appUrl } },
    { name: 'ingress', use: { ...devices['Desktop Chrome'], baseURL: ingressUrl } },
  ],
});
