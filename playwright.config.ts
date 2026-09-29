import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/integration',
  timeout: 45_000,
  workers: 1,
  globalSetup: './tests/start-servers.ts',
  reporter: [['list'], ['json', { outputFile: 'artifacts/p1/playwright-results.json' }]],
  use: { browserName: 'chromium', channel: 'chrome', viewport: { width: 1280, height: 1000 } },
  projects: [
    { name: 'dev-dpr1', use: { baseURL: 'http://127.0.0.1:5173', deviceScaleFactor: 1 } },
    { name: 'dev-dpr2', use: { baseURL: 'http://127.0.0.1:5173', deviceScaleFactor: 2 } },
    { name: 'production-dpr1', use: { baseURL: 'http://127.0.0.1:4173', deviceScaleFactor: 1 } },
    { name: 'production-dpr2', use: { baseURL: 'http://127.0.0.1:4173', deviceScaleFactor: 2 } },
  ],
});
