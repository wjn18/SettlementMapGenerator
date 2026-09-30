import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const water of [false, true]) test(`castle is one seamless building in preview and SVG export (${water ? 'estuary' : 'inland'})`, async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`/?test=1&seed=42&size=40&castle=true&theme=modern&labels=false${water ? '&coast=west&river=true' : ''}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const castle = await page.evaluate(() => {
    const api = (window as any).__playground, town = api.town;
    const district = town.districts.find((d: any) => d.wardType === 'Castle');
    const buildings = town.buildings.filter((b: any) => b.districtId === district.id);
    const points = buildings[0].boundary.map((id: string) => {
      const { x, y } = town.vertices.find((v: any) => v.id === id); return { x, y };
    });
    const commands = api.scene.commands.filter((c: any) => c.kind === 'polygon' && JSON.stringify(c.points) === JSON.stringify(points));
    const x = points.map((p: any) => p.x), y = points.map((p: any) => p.y);
    api.setViewport({ centerX: (Math.min(...x) + Math.max(...x)) / 2, centerY: (Math.min(...y) + Math.max(...y)) / 2, zoom: 8 });
    const last = points.at(-1);
    return { count: buildings.length, commands: commands.length, path: `M ${last.x} ${last.y} ` + points.map((p: any) => `L ${p.x} ${p.y}`).join(' ') + ' Z' };
  });
  expect(castle.count).toBe(1); expect(castle.commands).toBe(1);
  for (const renderer of ['canvas', 'svg', 'openfl']) {
    await page.locator('#renderer').selectOption(renderer);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.locator('#map').screenshot({ path: `artifacts/castle/${water ? 'estuary' : 'inland'}-${renderer}-${info.project.name}.png` });
  }
  const pending = page.waitForEvent('download'); await page.locator('#export-svg').click();
  const download = await pending, xml = readFileSync((await download.path())!, 'utf8');
  expect(await page.evaluate(({ xml, path }) => {
    const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
    return [...doc.querySelectorAll('path')].filter(p => p.getAttribute('d') === path).length;
  }, { xml, path: castle.path })).toBe(1);
  expect(errors).toEqual([]);
});
