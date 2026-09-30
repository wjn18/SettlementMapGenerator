import { defineConfig } from '@playwright/test';
import p4 from './playwright.p4.config';
export default defineConfig({...p4,testMatch:['**/p3/*.spec.ts','**/p4/*.spec.ts','**/p5/*.spec.ts'],reporter:[['list'],['json',{outputFile:'artifacts/p5/playwright-results.json'}]]});
