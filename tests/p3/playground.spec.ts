import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
// @ts-expect-error Independent fixture conversion is a Node-only helper.
import { legacyTown } from './legacy-town.mjs';
// @ts-expect-error PNG comparison helper is a Node-only module.
import { compareLegacy } from './compare-legacy.mjs';
declare global { interface Window { __playground: any; __events: any } }
const ready = async (page: import('@playwright/test').Page) => { await expect(page.locator('body')).toHaveAttribute('data-ready', 'true'); await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); };

test('generation controls, URL, hover, viewport, theme and JSON round trip', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?test=1&seed=42&size=15'); await ready(page);
  const original = await page.evaluate(() => JSON.stringify(window.__playground.town));
  const count = await page.evaluate(() => window.__playground.generationCount);
  const target = await page.evaluate(() => {
    const a = window.__playground, host = document.querySelector('#map')!.getBoundingClientRect();
    const points = a.scene.hitRegions[0].points;
    const p = points.reduce((s: {x:number;y:number}, v:{x:number;y:number}) => ({ x: s.x + v.x / points.length, y: s.y + v.y / points.length }), { x: 0, y: 0 });
    return { x: host.x + host.width / 2 + (p.x - a.viewport.centerX) * a.viewport.zoom, y: host.y + host.height / 2 + (p.y - a.viewport.centerY) * a.viewport.zoom };
  });
  await page.mouse.move(target.x, target.y); await expect(page.locator('#tooltip')).toBeVisible();
  await page.locator('#zoom-in').click(); await expect(page.locator('#zoom-label')).toHaveText('125%');
  await page.locator('#theme').selectOption('blueprint'); await expect(page).toHaveURL(/theme=blueprint/);
  expect(await page.evaluate(() => JSON.stringify(window.__playground.town))).toBe(original);
  expect(await page.evaluate(() => window.__playground.generationCount)).toBe(count);
  const beforePan = await page.evaluate(() => window.__playground.viewport);
  await page.locator('#map').focus(); await page.keyboard.press('ArrowRight');
  expect((await page.evaluate(() => window.__playground.viewport)).centerX).toBeGreaterThan(beforePan.centerX);
  await page.locator('#fit').click(); await expect(page.locator('#zoom-label')).toHaveText('100%');
  const downloadPromise = page.waitForEvent('download'); await page.locator('#export').click(); const download = await downloadPromise;
  const json = readFileSync((await download.path())!, 'utf8'); expect(JSON.parse(json)).toEqual(JSON.parse(original));
  await page.locator('#seed').fill('12345'); await page.locator('#size').selectOption('6'); await page.locator('#castle').selectOption('false'); await page.locator('#generate').click();
  await expect.poll(() => page.evaluate(() => window.__playground.town.resolved.seed)).toBe(12345);
  await expect(page).toHaveURL(/size=6/);
  await page.locator('#file').setInputFiles({ name: 'town.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(page.locator('#status')).toContainText('已导入'); expect(await page.evaluate(() => JSON.stringify(window.__playground.town))).toBe(JSON.stringify(JSON.parse(json)));
  const previousRevision = await page.evaluate(() => window.__playground.revision);
  await page.locator('#file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":"9"}') });
  await expect(page.locator('#error')).toContainText('导入失败'); expect(await page.evaluate(() => window.__playground.revision)).toBe(previousRevision);
  const canvas = await page.locator('#map canvas').evaluate(c => ({ width: (c as HTMLCanvasElement).width, css: c.getBoundingClientRect().width }));
  expect(canvas.width).toBe(Math.round(canvas.css * Number(info.project.use.deviceScaleFactor)));
  expect(errors).toEqual([]);
});

test('fixed P1 data render consistently across dev/production and JSON reload', async ({ page }, info) => {
  // These historical baselines belong to the OpenFL migration renderer.
  await page.setViewportSize({ width: 800, height: 800 }); await page.goto('/?test=1&capture=1&renderer=openfl'); await ready(page);
  for (const [seed, size] of [[42, 15], [1, 6], [12345, 24]]) {
    const fixed = legacyTown(seed, size);
    await page.evaluate(({ town, radius }) => { window.__playground.load(JSON.stringify(town)); window.__playground.setViewport({ centerX: 0, centerY: 0, zoom: 400 / radius }); }, fixed);
    await ready(page); await page.mouse.move(799, 799);
    const dpr = info.project.use.deviceScaleFactor;
    await expect(page.locator('#map')).toHaveScreenshot(`map-${seed}-${size}-dpr${dpr}.png`, { scale: 'device', maxDiffPixelRatio: 0.001, threshold: 0.1, animations: 'disabled' });
    const before = await page.locator('#map').screenshot();
    const legacyPath = `tests/fixtures/p1/legacy/seed-${seed}-size-${size}-dpr${dpr}.png`;
    if (existsSync(legacyPath)) {
      const difference = compareLegacy(before, readFileSync(legacyPath));
      expect(difference.meanAbsoluteChannelError).toBeLessThan(1);
      expect(difference.changedPixelRatio).toBeLessThan(0.025);
      await info.attach(`legacy-comparison-${seed}-${size}-dpr${dpr}`, { body: JSON.stringify(difference, null, 2), contentType: 'application/json' });
    }
    await page.evaluate(() => window.__playground.load(JSON.stringify(window.__playground.town)));
    await page.evaluate(radius => window.__playground.setViewport({ centerX: 0, centerY: 0, zoom: 400 / radius }), fixed.radius); await ready(page);
    expect(await page.locator('#map').screenshot()).toEqual(before);
  }
});

test('resize, DPR update and repeated renderer disposal preserve hit coordinates', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const listeners = new Map<string, Set<any>>(), add = window.addEventListener, remove = window.removeEventListener;
    const pending = new Set<number>(), raf = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => { const id = raf.call(window, time => { pending.delete(id); callback(time); }); pending.add(id); return id; };
    window.addEventListener = function(type: any, listener: any, options: any) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener); return add.call(this, type, listener, options); } as typeof add;
    window.removeEventListener = function(type: any, listener: any, options: any) { listeners.get(type)?.delete(listener); return remove.call(this, type, listener, options); } as typeof remove;
    window.__events = { counts: () => Object.fromEntries([...listeners].map(([k, v]) => [k, v.size])), pendingFrames: () => pending.size };
  });
  await page.goto('/?test=1'); await ready(page);
  const counts = await page.evaluate(() => window.__events.counts());
  const frames = await page.evaluate(() => window.__events.pendingFrames());
  for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__playground.remount()); await ready(page); }
  expect(await page.locator('#map canvas').count()).toBe(1); expect(await page.evaluate(() => window.__events.counts())).toEqual(counts);
  expect(await page.evaluate(() => window.__events.pendingFrames())).toBeLessThanOrEqual(frames);
  const hit = await page.evaluate(() => {
    const api = window.__playground, p = api.scene.hitRegions[0].points[0];
    api.setViewport({ centerX: p.x, centerY: p.y, zoom: 4 });
    const box = document.querySelector('#map')!.getBoundingClientRect(); return api.pick(box.width / 2, box.height / 2);
  });
  await page.evaluate(() => window.__playground.resize(600, 400, 2)); await ready(page);
  expect(await page.locator('#map canvas').evaluate(c => [(c as HTMLCanvasElement).width, (c as HTMLCanvasElement).height])).toEqual([1200, 800]);
  expect(await page.evaluate(() => window.__playground.pick(300, 200))).toBe(hit);
  await page.evaluate(() => window.__playground.resize(600, 400, 1)); await ready(page);
  expect(await page.locator('#map canvas').evaluate(c => [(c as HTMLCanvasElement).width, (c as HTMLCanvasElement).height])).toEqual([600, 400]);
  await page.setViewportSize({ width: 390, height: 844 }); await ready(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('invalid URL options remain visible and recover through the form', async ({ page }) => {
  await page.goto('/?test=1&seed=0&size=6'); await expect(page.locator('#error')).toContainText('INVALID_OPTIONS');
  await page.locator('#seed').fill('42'); await page.locator('#generate').click(); await ready(page); await expect(page.locator('#error')).toBeHidden();
});
