import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4273';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_TEST_BASE_URL
    ? undefined
    : [
        {
          command: 'vercel dev --listen 3000',
          url: 'http://localhost:3000',
          reuseExistingServer: false,
          timeout: 180_000,
        },
        {
          command: 'VITE_LOCAL_API_INDEX_PROXY=1 npm run dev -- --port 4273',
          url: 'http://localhost:4273',
          reuseExistingServer: false,
          timeout: 180_000,
        },
      ],
});
