import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

test('river controls, bridges, three renderers and lossless exports', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?test=1&seed=352656828&size=40&plaza=true&castle=true&walls=true&theme=june&districts=true&river=true');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#river')).toHaveValue('true');
  await expect(page.locator('#resolved')).toContainText('座桥');
  const original = await page.evaluate(() => JSON.stringify((window as any).__playground.town));
  const river = JSON.parse(original).river; expect(river.bridges.length).toBeGreaterThan(0);
  for (const kind of ['canvas', 'svg', 'openfl']) {
    await page.locator('#renderer').selectOption(kind);
    expect(await page.evaluate(() => JSON.stringify((window as any).__playground.town))).toBe(original);
    await page.screenshot({ path: `artifacts/river/${info.project.name}-${kind}.png` });
  }
  for (const format of ['svg', 'png']) {
    const pending = page.waitForEvent('download'); await page.locator(format === 'svg' ? '#export-svg' : '#export-image').click();
    const download = await pending, data = readFileSync((await download.path())!);
    if (format === 'svg') { expect(data.toString()).toContain('#adc6cb'); expect(data.toString()).toContain(`stroke-width="${river.width}"`); }
    else { const png = PNG.sync.read(data); expect(png.width).toBeGreaterThan(500); expect(data.length).toBeGreaterThan(10000); }
  }
  const pending = page.waitForEvent('download'); await page.locator('#export').click();
  const saved = readFileSync((await (await pending).path())!, 'utf8');
  expect(JSON.parse(saved)).toEqual(JSON.parse(original));
  await page.locator('#river').selectOption('false'); await page.locator('#generate').click();
  await expect(page).toHaveURL(/river=false/);
  expect(await page.evaluate(() => (window as any).__playground.town.river)).toBeUndefined();
  await page.locator('#file').setInputFiles({ name: 'river.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
  await expect(page.locator('#status')).toContainText('已导入');
  await expect(page.locator('#river')).toHaveValue('true');
  expect(await page.evaluate(() => (window as any).__playground.town)).toEqual(JSON.parse(original));
  await page.reload(); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  expect(await page.evaluate(() => (window as any).__playground.town.river)).toEqual(river);
  expect(errors).toEqual([]);
});
