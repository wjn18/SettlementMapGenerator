import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const url = '/?test=1&seed=42&size=24&coast=east&river=true&harbor=true&castle=true&plaza=true&walls=false&theme=modern&districts=false&labels=true';
test('grid, scale and compass share all renderers, update with the camera and survive export and reload', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const original = await page.evaluate(() => ({ town: JSON.stringify(window.__playground.town), count: window.__playground.generationCount, view: window.__playground.viewport }));
  expect(JSON.parse(original.town).atlas.cityName).toMatch(/^[A-Za-z]+$/);
  for (const control of ['#show-grid', '#show-scale', '#show-compass']) await expect(page.locator(control)).toBeChecked();
  for (const kind of ['canvas', 'svg', 'openfl']) {
    await page.locator('#renderer').selectOption(kind);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `artifacts/cartography/${info.project.name}-${kind}.png` });
    await expect(page.locator('#map canvas, #map svg')).toHaveCount(1);
    if (kind === 'svg') {
      await expect(page.locator('#map [data-cartography-layer]')).toHaveCount(3);
      await expect(page.locator('#map [data-cartography-layer="grid"]')).toHaveAttribute('data-step-meters', '100');
      await expect(page.locator('#map [data-cartography-layer="compass"] text')).toHaveText('N');
    }
    for (const format of ['png', 'svg']) {
      const pending = page.waitForEvent('download'); await page.locator(format === 'svg' ? '#export-svg' : '#export-image').click();
      const bytes = readFileSync((await (await pending).path())!);
      if (format === 'svg') {
        const overlays = await page.evaluate(xml => {
          const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
          return { layers: [...doc.querySelectorAll('[data-cartography-layer]')].map(e => e.getAttribute('data-cartography-layer')), scale: doc.querySelector('[data-cartography-layer="scale"]')?.textContent, compass: doc.querySelector('[data-cartography-layer="compass"]')?.textContent, error: !!doc.querySelector('parsererror') };
        }, bytes.toString());
        expect(overlays).toMatchObject({ layers: ['grid', 'scale', 'compass'], compass: 'N', error: false });
        expect(overlays.scale).toMatch(/m$/);
      } else if (kind === 'canvas') {
        const data = await page.locator('#map canvas').evaluate(e => (e as HTMLCanvasElement).toDataURL().split(',')[1]);
        const preview = PNG.sync.read(Buffer.from(data, 'base64')), exported = PNG.sync.read(bytes);
        expect(exported.width).toBe(preview.width); expect(exported.height).toBe(preview.height);
        expect(Buffer.compare(exported.data, preview.data)).toBe(0);
      }
    }
  }
  expect(await page.evaluate(() => ({ town: JSON.stringify(window.__playground.town), count: window.__playground.generationCount, view: window.__playground.viewport }))).toEqual(original);
  await page.locator('#renderer').selectOption('svg');
  const grid = page.locator('#map [data-cartography-layer="grid"]'), scale = page.locator('#map [data-cartography-layer="scale"]');
  const beforeLine = await grid.locator('path').first().getAttribute('d'), beforeScale = Number(await scale.getAttribute('data-distance-meters'));
  await page.locator('#map').focus(); await page.keyboard.press('ArrowRight');
  expect(await grid.locator('path').first().getAttribute('d')).not.toBe(beforeLine);
  expect(Number(await scale.getAttribute('data-distance-meters'))).toBe(beforeScale);
  for (let i = 0; i < 4; i++) await page.locator('#zoom-in').click();
  expect(Number(await scale.getAttribute('data-distance-meters'))).toBeLessThan(beforeScale);
  await page.locator('#grid-size').selectOption('50'); await expect(grid).toHaveAttribute('data-step-meters', '50');
  await page.locator('#show-scale').uncheck(); await expect(scale).toHaveCount(0);
  await page.locator('#show-compass').uncheck(); await expect(page.locator('#map [data-cartography-layer="compass"]')).toHaveCount(0);
  await page.locator('#show-grid').uncheck(); await expect(grid).toHaveCount(0); await expect(page.locator('#grid-size')).toBeDisabled();
  await page.reload(); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  for (const control of ['#show-grid', '#show-scale', '#show-compass']) await expect(page.locator(control)).not.toBeChecked();
  await expect(page.locator('#grid-size')).toHaveValue('50'); await expect(page.locator('#map [data-cartography-layer]')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(window.__playground.town))).toBe(original.town);
  await page.locator('#show-grid').check(); await page.locator('#grid-size').selectOption('auto');
  await expect(grid).toHaveCount(1); expect(Number(await grid.getAttribute('data-step-meters'))).toBeGreaterThan(0);
  await expect(page.locator('#grid-readout')).toBeVisible();
  await page.locator('#show-scale').check(); await page.locator('#show-compass').check();
  await page.locator('#show-names').uncheck(); await expect(page.locator('#map [data-cartography-layer]')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('cartography controls and corner ornaments fit a narrow viewport', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url + '&renderer=svg'); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.locator('.cartography-tools').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(page.locator('#map [data-cartography-layer]')).toHaveCount(3);
  const contained = await page.locator('#map svg').evaluate(svg => {
    const bounds = svg.getBoundingClientRect();
    return [...svg.querySelectorAll('[data-cartography-layer="compass"], [data-cartography-layer="scale"]')].every(e => { const b = e.getBoundingClientRect(); return b.left >= bounds.left && b.right <= bounds.right && b.top >= bounds.top && b.bottom <= bounds.bottom; });
  });
  expect(contained).toBe(true);
  await page.locator('main').screenshot({ path: `artifacts/cartography/${info.project.name}-mobile.png` });
  await page.locator('#grid-size').selectOption('25');
  for (let i = 0; i < 5; i++) await page.locator('#zoom-out').click();
  const step = await page.locator('#map [data-cartography-layer="grid"]').getAttribute('data-step-meters');
  expect(Number(step)).toBeGreaterThan(25);
  await expect(page.locator('#grid-readout')).toBeVisible();
  await expect(page.locator('#grid-readout')).toContainText(`${step} m`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
