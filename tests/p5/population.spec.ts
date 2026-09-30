import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const url = '/?test=1&seed=42&size=24&coast=east&river=true&harbor=true&castle=true&plaza=true&walls=false&theme=modern&districts=false';
test('population estimates, density, regional information, reports and imported maps stay in sync', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const snapshot = () => page.evaluate(() => ({ town: JSON.stringify(window.__playground.town), scene: JSON.stringify(window.__playground.scene), count: window.__playground.generationCount, viewport: window.__playground.viewport }));
  const original = await snapshot(), initial = await page.evaluate(() => window.__playground.population);
  expect(initial.total.residents).toBeGreaterThan(0);
  expect(initial.modelVersion).toBe('2');
  expect(initial.total.residents).toBe(Math.round(initial.city.urbanAreaM2 / 100));
  expect(initial.outskirts.residents).toBeNull();
  await expect(page.locator('#population-split')).toContainText('公顷 · 城郊未估算');
  await expect(page.locator('#population-density option')).toHaveText(['低密度 · 50 人/公顷', '基准密度 · 100 人/公顷', '高密度 · 200 人/公顷']);
  await expect(page.locator('#population-total')).toHaveAttribute('data-residents', String(initial.total.residents));
  await expect(page.locator('#population-density')).toHaveValue('typical');
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `artifacts/population/${info.project.name}-overview.png` });
  await page.locator('#population-density').selectOption('sparse');
  expect((await page.evaluate(() => window.__playground.population.total.residents))).toBeLessThan(initial.total.residents);
  await page.locator('#population-density').selectOption('dense');
  expect((await page.evaluate(() => window.__playground.population.total.residents))).toBeGreaterThan(initial.total.residents);
  expect(await snapshot()).toEqual(original);
  await page.locator('#population-details summary').click();
  const dense = await page.evaluate(() => window.__playground.population);
  expect(dense.total.lower).toBe(initial.total.lower); expect(dense.total.upper).toBe(initial.total.upper);
  expect(dense.total.residents).toBe(dense.total.upper);
  await expect(page.locator('#population-formula')).toContainText('200 人/公顷');
  await expect(page.locator('#population-sources a')).toHaveAttribute('href', 'https://researchdatajournal.org/article/download/24674/25863/63436');
  await expect(page.locator('#population-limitations')).toContainText('不是统计置信区间');
  for (const region of dense.regions) await expect(page.locator(`#population-regions tr[data-region="${region.regionId}"] td`)).toHaveAttribute('data-residents', String(region.residents));
  await page.locator('.population-card').screenshot({ path: `artifacts/population/${info.project.name}-details.png` });
  await page.locator('#population-details summary').click();
  for (const kind of ['canvas', 'svg', 'openfl']) {
    await page.locator('#renderer').selectOption(kind); await page.locator('#map').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.__playground.population)).toEqual(dense);
    const target = await page.evaluate(() => {
      const a = window.__playground, host = document.getElementById('map')!, rect = host.getBoundingClientRect(), region = a.town.atlas.regions[0];
      for (const id of region.districtIds) {
        const ring = a.town.districts.find(d => d.id === id).boundary.map(id => a.town.vertices.find(v => v.id === id));
        const x = host.clientWidth / 2 + (ring.reduce((sum, p) => sum + p.x, 0) / ring.length - a.viewport.centerX) * a.viewport.zoom;
        const y = host.clientHeight / 2 + (ring.reduce((sum, p) => sum + p.y, 0) / ring.length - a.viewport.centerY) * a.viewport.zoom;
        if (a.pick(x, y) === id) return { x: rect.left + x, y: rect.top + y, id: region.id };
      }
      throw new Error('No regional pick target');
    });
    await page.mouse.move(target.x, target.y); await expect(page.locator('#tooltip')).toContainText('人口估算');
    await page.mouse.click(target.x, target.y); await expect(page.locator('#region-details')).toContainText('人口估算');
    await page.locator('#close-names').click();
  }
  await page.locator('#edit-names').click(); await page.locator('#region-name').fill('New Quarter'); await page.locator('#region-name-form button').click(); await page.locator('#close-names').click();
  await page.locator('#population-details summary').click();
  await expect(page.locator('#population-regions tr').first()).toContainText('New Quarter');
  const pending = page.waitForEvent('download'); await page.locator('#population-report').click();
  const report = JSON.parse(readFileSync((await (await pending).path())!, 'utf8'));
  expect(report.kind).toBe('settlement-population-report'); expect(report.seed).toBe(42);
  expect(report.estimate).toEqual(await page.evaluate(() => window.__playground.population));
  await page.reload(); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#population-density')).toHaveValue('dense');
  expect(await page.evaluate(() => window.__playground.population)).toEqual(report.estimate);
  const legacy = JSON.parse(original.town); delete legacy.atlas;
  await page.locator('#file').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
  await expect(page.locator('#status')).toContainText('已导入');
  expect(await page.evaluate(() => window.__playground.population.total)).toEqual(dense.total);
  expect(await page.evaluate(() => window.__playground.town)).toEqual(legacy);
  const empty = { ...legacy, buildings: [] };
  await page.locator('#file').setInputFiles({ name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(empty)) });
  await expect(page.locator('#population-total')).toHaveAttribute('data-residents', String(dense.total.residents));
  const emptyEstimate = await page.evaluate(() => window.__playground.population);
  expect(emptyEstimate.unallocated.residents).toBe(dense.total.residents);
  await page.locator('#population-details').evaluate((element: HTMLDetailsElement) => { element.open = true; });
  await expect(page.locator('#population-unallocated')).toContainText('未分配到区域');
  await expect(page.locator('#population-range')).toContainText('低–高情景');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.locator('.population-card').screenshot({ path: `artifacts/population/${info.project.name}-mobile.png` });
  expect(errors).toEqual([]);
});
