import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

// Map export sorts object keys; compare data independent of property order.
const hash = (text: string) => createHash('sha256').update(JSON.stringify(JSON.parse(text), (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)).digest('hex');
for (const water of [false, true]) test(`100-district city: presets, population, renderers and JSON (${water ? 'estuary' : 'inland'})`, async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`/?test=1&seed=42&size=24&castle=true&plaza=true&walls=false&theme=modern&districts=false${water ? '&coast=east&river=true' : ''}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  expect(await page.locator('#size option').allTextContents()).toEqual(['村落 · 6 地块', '小镇 · 12 地块', '大镇 · 24 地块', '小城 · 40 地块', '中城 · 60 地块', '大城 · 80 地块', '都会 · 100 地块']);
  await page.locator('#size').selectOption('100'); await page.locator('#generate').click();
  await expect(page).toHaveURL(/size=100/, { timeout: 20_000 });
  await expect(page.locator('#error')).toBeHidden();
  const stats = await page.evaluate(() => {
    const a = window.__playground;
    return { size: a.town.resolved.size, districts: a.town.districts.filter(d => d.withinCity).length, buildings: a.town.buildings.length, population: a.population.total.residents };
  });
  expect(stats.size).toBe(100); expect(stats.districts).toBeGreaterThanOrEqual(100); expect(stats.buildings).toBeGreaterThan(100);
  await expect(page.locator('#district-count')).toHaveText(String(stats.districts));
  await expect(page.locator('#population-total')).toHaveAttribute('data-residents', String(stats.population));
  const snapshot = () => page.evaluate(() => JSON.stringify(window.__playground.town));
  const original = await snapshot(), digest = hash(original);
  for (const renderer of ['canvas', 'svg', 'openfl']) {
    await page.locator('#renderer').selectOption(renderer);
    await page.locator('#zoom-in').click(); await expect(page.locator('#zoom-label')).toHaveText('125%');
    await page.locator('#fit').click();
    expect(hash(await snapshot())).toBe(digest);
    if (renderer === 'canvas') {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `artifacts/city-sizes/${info.project.name}-${water ? 'estuary' : 'inland'}.png` });
    }
  }
  for (const format of ['svg', 'png']) {
    const pending = page.waitForEvent('download'); await page.locator(format === 'svg' ? '#export-svg' : '#export-image').click();
    const bytes = readFileSync((await (await pending).path())!);
    if (format === 'png') expect(PNG.sync.read(bytes).width).toBeGreaterThan(500);
    else {
      const counts = await page.evaluate(xml => {
        const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
        return { paths: doc.querySelectorAll('path').length, errors: doc.querySelectorAll('parsererror').length };
      }, bytes.toString());
      expect(counts.errors).toBe(0); expect(counts.paths).toBeGreaterThanOrEqual(stats.buildings);
    }
  }
  const pending = page.waitForEvent('download'); await page.locator('#export').click();
  const json = readFileSync((await (await pending).path())!, 'utf8');
  expect(JSON.parse(json).request.size).toBe(100);
  await page.locator('#file').setInputFiles({ name: 'metropolis.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(page.locator('#status')).toContainText('已导入'); expect(hash(await snapshot())).toBe(digest);
  await page.reload(); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  await expect(page.locator('#size')).toHaveValue('100');
  const reloaded = JSON.parse(await snapshot()), expected = JSON.parse(original);
  // Sharing a URL spells out the optional water switches even for inland maps.
  expected.request = { ...expected.request, coast: water ? 'east' : false, river: water, harbor: true };
  expect(hash(JSON.stringify(reloaded))).toBe(hash(JSON.stringify(expected)));
  expect(errors).toEqual([]);
});

test('previous non-preset sizes stay editable through URLs and JSON import', async ({ page }) => {
  await page.goto('/?test=1&seed=42&size=15'); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#size')).toHaveValue('15'); await expect(page.locator('#size option:checked')).toHaveText('自定 · 15 地块');
  const json = await page.evaluate(() => JSON.stringify(window.__playground.town));
  await page.locator('#size').selectOption('12'); await page.locator('#generate').click(); await expect(page).toHaveURL(/size=12/);
  await page.locator('#file').setInputFiles({ name: 'previous.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(page.locator('#size')).toHaveValue('15'); await expect(page.locator('#status')).toContainText('已导入');
});
