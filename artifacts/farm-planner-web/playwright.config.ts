import { defineConfig } from '@playwright/test';

const port = 4174;

export default defineConfig({
  testDir: './browser-tests',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
      args: ['--disable-dev-shm-usage'],
    },
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm run dev',
    cwd: import.meta.dirname,
    env: {
      BASE_PATH: '/',
      PORT: String(port),
      VITE_AUTH_DISABLED: 'true',
      VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k',
    },
    reuseExistingServer: !process.env.CI,
    url: `http://127.0.0.1:${port}`,
    timeout: 120_000,
  },
});