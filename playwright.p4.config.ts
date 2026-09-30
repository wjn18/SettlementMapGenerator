import { defineConfig } from '@playwright/test';
import p3 from './playwright.p3.config';
export default defineConfig({
  ...p3, testDir: './tests', testMatch: ['**/p3/*.spec.ts','**/p4/*.spec.ts'],
  snapshotPathTemplate: '{testDir}/fixtures/p3/{arg}{ext}',
  reporter: [['list'],['json',{outputFile:'artifacts/p4/playwright-results.json'}]],
});
