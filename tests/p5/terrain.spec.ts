import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

test('coast and estuary controls, waterfront picking and complete image/JSON export', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?test=1&seed=42&size=24&coast=east&river=true&harbor=true&castle=true&plaza=true&walls=false&theme=modern&districts=false');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#resolved')).toContainText('河口');
  await expect(page.locator('#resolved')).toContainText('座码头');
  await expect(page.locator('#coast')).toHaveValue('east');
  await expect(page.locator('#harbor')).toBeEnabled();
  const original = await page.evaluate(() => JSON.stringify((window as any).__playground.town));
  const town = JSON.parse(original);
  expect(town.terrain.docks.length).toBeGreaterThan(0);
  expect(town.river.bridges.length).toBeGreaterThan(0);
  for (const kind of ['canvas', 'svg', 'openfl']) {
    await page.locator('#renderer').selectOption(kind);
    expect(await page.evaluate(() => JSON.stringify((window as any).__playground.town))).toBe(original);
    await page.screenshot({ path: `artifacts/terrain/${info.project.name}-${kind}.png` });
  }
  for (const format of ['svg', 'png', 'json']) {
    const pending = page.waitForEvent('download');
    await page.locator(format === 'svg' ? '#export-svg' : format === 'png' ? '#export-image' : '#export').click();
    const bytes = readFileSync((await (await pending).path())!);
    if (format === 'json') expect(JSON.parse(bytes.toString())).toEqual(town);
    else if (format === 'svg') { expect(bytes.toString()).toContain('#59a3b2'); expect(bytes.toString()).toContain('stroke-width="1.5"'); }
    else expect(PNG.sync.read(bytes).width).toBeGreaterThan(500);
  }
  await page.locator('#harbor').selectOption('false'); await page.locator('#generate').click();
  await expect(page).toHaveURL(/harbor=false/);
  expect(await page.evaluate(() => (window as any).__playground.town.terrain.docks.length)).toBe(0);
  await page.locator('#file').setInputFiles({ name: 'estuary.json', mimeType: 'application/json', buffer: Buffer.from(original) });
  await expect(page.locator('#status')).toContainText('已导入');
  expect(await page.evaluate(() => (window as any).__playground.town)).toEqual(town);
  await page.reload(); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  expect(await page.evaluate(() => (window as any).__playground.town)).toEqual(town);
  await page.locator('#coast').selectOption('false');
  await expect(page.locator('#harbor')).toBeDisabled();
  await page.locator('#river').selectOption('false'); await page.locator('#generate').click();
  await expect(page).toHaveURL(/coast=false/);
  expect(await page.evaluate(() => (window as any).__playground.town.terrain)).toBeUndefined();
  expect(errors).toEqual([]);
});
