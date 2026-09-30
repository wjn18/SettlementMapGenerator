import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/p3', testMatch: '**/*.spec.ts', timeout: 60_000, workers: 1,
  globalSetup: './tests/p3/start-servers.ts',
  snapshotPathTemplate: '{testDir}/../fixtures/p3/{arg}{ext}',
  reporter: [['list'], ['json', { outputFile: 'artifacts/p3/playwright-results.json' }]],
  use: { channel: 'chrome', viewport: { width: 1280, height: 900 }, screenshot: 'only-on-failure' },
  projects: [
    { name: 'dev-dpr1', use: { baseURL: 'http://127.0.0.1:5175', deviceScaleFactor: 1 } },
    { name: 'dev-dpr2', use: { baseURL: 'http://127.0.0.1:5175', deviceScaleFactor: 2 } },
    { name: 'prod-dpr1', use: { baseURL: 'http://127.0.0.1:4175', deviceScaleFactor: 1 } },
    { name: 'prod-dpr2', use: { baseURL: 'http://127.0.0.1:4175', deviceScaleFactor: 2 } },
  ],
});
