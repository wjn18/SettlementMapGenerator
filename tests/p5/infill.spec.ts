import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('reported wall gaps become urban land in every renderer and survive JSON export', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?test=1&seed=915481944&size=100&coast=auto&river=true&harbor=true&theme=modern&districts=true&labels=false&grid=false');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#size-note')).toContainText('墙内补建');
  const saved = await page.evaluate(() => JSON.stringify((window as any).__playground.town));
  const report = await page.evaluate(() => {
    const api = (window as any).__playground, town = api.town;
    const vertices = new Map(town.vertices.map((v: any) => [v.id, v]));
    const inside = (ids: string[], p: {x: number; y: number}) => {
      const ring = ids.map(id => vertices.get(id) as {x: number; y: number}); let result = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j], b = ring[i];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result;
      }
      return result;
    };
    // Centres of three large rural parcels enclosed by the 0.10 wall in the reported seed.
    const oldGaps = [{x:-415.074,y:57.325},{x:-540.013,y:66.183},{x:196.486,y:-455.364}];
    return {
      version: town.generatorVersion,
      filled: oldGaps.map(p => town.districts.some((d: any) => d.withinCity && inside(d.boundary, p))),
      population: api.population.city.residents,
      landArea: api.population.city.urbanAreaM2,
    };
  });
  expect(report.version).toBe('0.11.0'); expect(report.filled).toEqual([true, true, true]);
  expect(report.population).toBe(Math.round(report.landArea / 100));
  for (const kind of ['canvas', 'svg', 'openfl']) {
    await page.locator('#renderer').selectOption(kind);
    expect(await page.evaluate(() => JSON.stringify((window as any).__playground.town))).toBe(saved);
    await page.screenshot({ path: `artifacts/infill/${info.project.name}-${kind}.png` });
  }
  const pending = page.waitForEvent('download'); await page.locator('#export').click();
  const bytes = readFileSync((await (await pending).path())!);
  expect(JSON.parse(bytes.toString())).toEqual(JSON.parse(saved));
  await page.locator('#file').setInputFiles({ name: 'infill.json', mimeType: 'application/json', buffer: bytes });
  await expect(page.locator('#status')).toContainText('已导入');
  expect(await page.evaluate(() => (window as any).__playground.town)).toEqual(JSON.parse(saved));
  expect(errors).toEqual([]);
});
