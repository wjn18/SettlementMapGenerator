import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const backgrounds = { modern: '#e5e5da', turquoise: '#d1b488', fairytale: '#a5a552', tapestry: '#ccb28e', natural: '#bfbfb5', june: '#bfc192' };
test('six city palettes switch without regeneration, survive reload, and export in every renderer', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?test=1&seed=12345&size=40&walls=true&castle=true&theme=turquoise');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#theme')).toHaveValue('turquoise');
  await page.locator('#zoom-in').click();
  const snapshot = () => page.evaluate(() => {
    const a = (window as any).__playground;
    return { town: JSON.stringify(a.town), count: a.generationCount, view: a.viewport };
  });
  const before = await snapshot();
  for (const [name, background] of Object.entries(backgrounds)) {
    await page.locator('#theme').selectOption(name);
    expect(await snapshot()).toEqual(before);
    await expect(page).toHaveURL(new RegExp(`theme=${name}`));
    expect(await page.evaluate(() => (window as any).__playground.scene.background)).toBe(background);
    const scene = await page.evaluate(() => JSON.stringify((window as any).__playground.scene));
    for (const renderer of ['canvas', 'svg', 'openfl']) {
      await page.locator('#renderer').selectOption(renderer);
      expect(await snapshot()).toEqual(before);
      expect(await page.evaluate(() => JSON.stringify((window as any).__playground.scene))).toBe(scene);
      await expect(page.locator('#map canvas, #map svg')).toHaveCount(1);
    }
    await page.locator('#renderer').selectOption('canvas');
    await page.screenshot({ path: `artifacts/themes/${info.project.name}-${name}.png` });
  }
  await page.locator('#theme').selectOption('turquoise');
  for (const renderer of ['canvas', 'svg', 'openfl']) {
    await page.locator('#renderer').selectOption(renderer);
    for (const format of ['svg', 'png']) {
      const pending = page.waitForEvent('download');
      await page.locator(format === 'svg' ? '#export-svg' : '#export-image').click();
      const download = await pending, bytes = readFileSync((await download.path())!);
      if (format === 'svg') {
        const xml = bytes.toString();
        for (const color of ['#d1b488', '#e6dac2', '#f9f9dd']) expect(xml).toContain(color);
        expect(xml).toContain('<svg');
      } else {
        const png = PNG.sync.read(bytes);
        // A zoomed viewport can have farmland at the corner. Check visible
        // paper pixels across the export, independent of the generated outline.
        let paperPixels = 0;
        for (let i = 0; i < png.data.length; i += 4) if (png.data[i] === 209 && png.data[i + 1] === 180 && png.data[i + 2] === 136 && png.data[i + 3] === 255) paperPixels++;
        expect(paperPixels).toBeGreaterThan(png.width * png.height * 0.05);
        expect(png.width).toBeGreaterThan(500);
      }
      expect(await snapshot()).toEqual(before);
    }
  }
  await page.locator('#theme').selectOption('fairytale');
  await page.locator('#renderer').selectOption('svg');
  await expect(page.locator('#map [data-cartography-layer="compass"] text')).toHaveAttribute('fill', '#ffffe5');
  await page.reload(); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#theme')).toHaveValue('fairytale');
  expect(await page.evaluate(() => (window as any).__playground.scene.background)).toBe(backgrounds.fairytale);
  expect(errors).toEqual([]);
});

test('comparison exposes all twelve palettes and shares the new scene across renderers', async ({ page }) => {
  await page.goto('/compare.html?test=1&theme=tapestry');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#theme option')).toHaveCount(12);
  await expect(page.locator('#theme')).toHaveValue('tapestry');
  for (const [theme, background] of Object.entries(backgrounds)) {
    await page.locator('#theme').selectOption(theme);
    expect(await page.evaluate(() => (window as any).__comparison.scene.background)).toBe(background);
  }
});

test('district coloring has a matching legend and preserves the map, camera and exports', async ({ page }, info) => {
  await page.goto('/?test=1&seed=1411216976&size=40&plaza=true&castle=true&walls=true&theme=turquoise');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#district-colors')).toBeChecked();
  for (const type of ['CraftsmenWard', 'Slum', 'Castle']) await expect(page.locator(`[data-ward="${type}"]`)).toBeVisible();
  const colors = await page.locator('#district-keys i').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.backgroundColor));
  expect(new Set(colors).size).toBe(colors.length);
  const actualTypes = await page.evaluate(() => [...new Set((window as any).__playground.town.districts.filter((d: any) => d.withinCity || ['Park', 'Farm'].includes(d.wardType)).map((d: any) => d.wardType))].sort());
  expect((await page.locator('#district-keys [data-ward]').evaluateAll(nodes => nodes.map(n => (n as HTMLElement).dataset.ward))).sort()).toEqual(actualTypes);
  await page.locator('#zoom-in').click();
  const state = () => page.evaluate(() => {
    const a = (window as any).__playground; return { town: JSON.stringify(a.town), count: a.generationCount, view: a.viewport };
  });
  const before = await state();
  const colored = await page.evaluate(() => JSON.stringify((window as any).__playground.scene));
  await page.locator('#district-colors').uncheck();
  await expect(page).toHaveURL(/districts=false/);
  expect(await state()).toEqual(before);
  expect(await page.evaluate(() => JSON.stringify((window as any).__playground.scene))).not.toBe(colored);
  await expect(page.locator('#district-keys')).toHaveAttribute('aria-hidden', 'true');
  await page.locator('#district-colors').check();
  expect(await state()).toEqual(before);
  expect(await page.evaluate(() => JSON.stringify((window as any).__playground.scene))).toBe(colored);
  for (const kind of ['canvas', 'svg', 'openfl']) {
    await page.locator('#renderer').selectOption(kind);
    expect(await page.evaluate(() => JSON.stringify((window as any).__playground.scene))).toBe(colored);
  }
  const roofs = await page.evaluate(() => {
    const a = (window as any).__playground;
    return ['CraftsmenWard', 'Slum', 'Castle'].map(type => {
      const ids = new Set(a.town.districts.filter((d: any) => d.wardType === type).map((d: any) => d.id));
      const building = a.town.buildings.find((b: any) => ids.has(b.districtId));
      const points = building.boundary.map((id: string) => { const v = a.town.vertices.find((v: any) => v.id === id); return { x: v.x, y: v.y }; });
      return a.scene.commands.find((c: any) => c.kind === 'polygon' && JSON.stringify(c.points) === JSON.stringify(points)).fill;
    });
  });
  expect(new Set(roofs).size).toBe(3);
  const pending = page.waitForEvent('download'); await page.locator('#export-svg').click();
  const download = await pending, xml = readFileSync((await download.path())!, 'utf8');
  for (const roof of roofs) expect(xml).toContain(roof);
  await page.locator('#renderer').selectOption('canvas');
  await page.screenshot({ path: `artifacts/themes/${info.project.name}-districts.png` });
  await page.locator('#district-colors').uncheck();
  await page.reload(); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#district-colors')).not.toBeChecked();
  await page.locator('#district-colors').check();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#district-keys')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
