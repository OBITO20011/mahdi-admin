import { defineConfig, devices } from '@playwright/test';

const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: false,
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  workers: isCi ? 1 : 2,
  reporter: isCi
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: {
      proxy: { server: 'http://127.0.0.1:4175' },
    },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        locale: 'ar-JO',
        timezoneId: 'Asia/Amman',
      },
    },
    {
      name: 'mobile-webkit',
      use: {
        ...devices['iPhone 13'],
        locale: 'ar-JO',
        timezoneId: 'Asia/Amman',
      },
    },
    {
      name: 'mobile-chromium',
      testMatch: /admin-(?:(?:bottom-)?navigation|mobile-ux)\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        locale: 'ar-JO',
        timezoneId: 'Asia/Amman',
      },
    },
  ],
  webServer: [
    {
      command: 'node scripts/testing/run-browser-network-guard.mjs 4175',
      url: 'http://127.0.0.1:4175/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'node scripts/testing/run-isolated-api-stub.mjs 4176',
      url: 'http://127.0.0.1:4176/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'node scripts/testing/run-isolated-vite.mjs admin 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !isCi,
      timeout: 120_000,
    },
    {
      command: 'node scripts/testing/run-isolated-vite.mjs customer 4174',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: !isCi,
      timeout: 120_000,
    },
  ],
  globalSetup: './scripts/testing/playwright-global-setup.mjs',
  globalTeardown: './scripts/testing/playwright-global-teardown.mjs',
});
