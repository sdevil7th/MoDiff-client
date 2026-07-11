import { defineConfig, devices } from '@playwright/test';

const mockFrontendPort = Number(process.env.MODIFF_MOCK_FRONTEND_PORT || 5191);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 2 * 60 * 1000,
  expect: {
    timeout: 15 * 1000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${mockFrontendPort}`,
    url: `http://127.0.0.1:${mockFrontendPort}`,
    reuseExistingServer: false,
    timeout: 120 * 1000,
    env: {
      VITE_BACKEND_PROXY_TARGET: 'http://127.0.0.1:65530',
    },
  },
  use: {
    ...devices['Desktop Chrome'],
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
