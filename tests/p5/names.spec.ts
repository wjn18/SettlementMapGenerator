import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('regional labels, Unicode editing, URL/JSON persistence and three renderer exports', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?test=1&seed=42&size=24&coast=east&river=true&harbor=true&castle=true&plaza=true&walls=false&theme=modern&districts=false&labels=true');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const before = await page.evaluate(() => ({ town: JSON.stringify(window.__playground.town), count: window.__playground.generationCount }));
  const town = JSON.parse(before.town);
  await expect(page.locator('#map-title')).toContainText(town.atlas.cityName);
  for (const kind of ['canvas', 'svg', 'openfl']) {
    await page.locator('#renderer').selectOption(kind);
    await page.screenshot({ path: `artifacts/names/${info.project.name}-${kind}.png` });
    if (kind === 'svg') expect(await page.locator('#map [data-label-id]').count()).toBeGreaterThan(3);
    await expect(page.locator('#map canvas, #map svg')).toHaveCount(1);
    const target = await page.evaluate(() => {
      const api = window.__playground, town = api.town, view = api.viewport, host = document.getElementById('map')!;
      const box = host.getBoundingClientRect();
      for (const region of town.atlas.regions) for (const id of region.districtIds) {
        const district = town.districts.find(d => d.id === id)!;
        const points = district.boundary.map(id => town.vertices.find(v => v.id === id)!);
        const x = host.clientWidth / 2 + (points.reduce((sum, p) => sum + p.x, 0) / points.length - view.centerX) * view.zoom;
        const y = host.clientHeight / 2 + (points.reduce((sum, p) => sum + p.y, 0) / points.length - view.centerY) * view.zoom;
        if (api.pick(x, y) === id) return { x: box.left + x, y: box.top + y, id: region.id, name: region.name, count: region.districtIds.length };
      }
      throw new Error('No visible regional pick target');
    });
    await page.mouse.move(target.x, target.y);
    await expect(page.locator('#tooltip')).toBeVisible();
    await expect(page.locator('#tooltip')).toContainText(target.name);
    await expect(page.locator('#tooltip')).toContainText(`${target.count} 个地块`);
    await page.mouse.click(target.x, target.y);
    await expect(page.locator('#names-panel')).toBeVisible();
    await expect(page.locator('#region-select')).toHaveValue(target.id);
    await page.locator('#close-names').click();
  }
  await page.locator('#edit-names').click();
  await page.locator('#city-name').fill('雾港'); await page.locator('#city-name-form button').click();
  await page.locator('#region-name').fill('旧城商埠'); await page.locator('#region-name-form button').click();
  await expect(page.locator('#status')).toContainText('地名已保存');
  await expect(page.locator('#map-title')).toContainText('雾港');
  const edited = await page.evaluate(() => window.__playground.town);
  expect(edited.atlas.regions[0].name).toBe('旧城商埠'); expect(edited.atlas.cityName).toBe('雾港');
  const { atlas, ...geometry } = town, { atlas: nextAtlas, ...nextGeometry } = edited;
  expect(nextGeometry).toEqual(geometry); expect(await page.evaluate(() => window.__playground.generationCount)).toBe(before.count);
  await page.locator('#close-names').click();
  for (const kind of ['canvas', 'svg', 'openfl']) {
    await page.locator('#renderer').selectOption(kind);
    await page.screenshot({ path: `artifacts/names/${info.project.name}-${kind}-chinese.png` });
  }
  for (const format of ['svg', 'png', 'json']) {
    const pending = page.waitForEvent('download'); await page.locator(format === 'svg' ? '#export-svg' : format === 'png' ? '#export-image' : '#export').click();
    const bytes = readFileSync((await (await pending).path())!);
    if (format === 'svg') { expect(bytes.toString().includes('<title>雾港</title>')).toBe(true); expect(bytes.toString().includes('<title>旧城商埠</title>')).toBe(true); }
    else if (format === 'json') expect(JSON.parse(bytes.toString())).toEqual(edited);
    else expect(bytes.length).toBeGreaterThan(10000);
  }
  await page.reload(); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  expect(await page.evaluate(() => window.__playground.town.atlas)).toEqual(edited.atlas);
  await page.locator('#file').setInputFiles({ name: 'named.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(edited)) });
  await expect(page.locator('#status')).toContainText('已导入');
  expect(await page.evaluate(() => window.__playground.town)).toEqual(edited);
  await page.locator('#renderer').selectOption('svg');
  await page.locator('#show-names').uncheck(); await expect(page.locator('#map [data-map-labels] text')).toHaveCount(0);
  expect(await page.evaluate(() => window.__playground.town.atlas)).toEqual(edited.atlas);
  await page.locator('#show-names').check(); await expect(page.locator('#map [data-label-id="city-name"]')).toBeVisible();
  await page.locator('#edit-names').click(); await page.locator('#city-name').fill('   '); await page.locator('#city-name-form button').click();
  await expect(page.locator('#name-error')).toBeVisible();
  expect(await page.evaluate(() => window.__playground.town.atlas.cityName)).toBe('雾港');
  await page.locator('#city-name').fill('<港&湾>'); await page.locator('#city-name-form button').click();
  await expect(page.locator('#map [data-label-id="city-name"]')).toHaveAttribute('aria-label', '<港&湾>');
  const svgDownload = page.waitForEvent('download'); await page.locator('#export-svg').click();
  const xml = readFileSync((await (await svgDownload).path())!).toString();
  expect(xml).toContain('<title>&lt;港&amp;湾&gt;</title>');
  expect(xml).not.toContain('<港');
  expect(errors).toEqual([]);
});
