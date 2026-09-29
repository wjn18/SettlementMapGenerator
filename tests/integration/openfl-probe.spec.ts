import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const legacy = JSON.parse(gunzipSync(readFileSync('tests/fixtures/p1/legacy/seed-12345-size-24.json.gz')).toString());

test('OpenFL graphics, bitmap font, transparent hit region, zoom and responsive DPR', async ({ page, browser }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const map = page.locator('#map');
  const canvas = map.locator('canvas');
  await expect(canvas).toHaveCount(1);
  const read = () => page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const dpr = devicePixelRatio;
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0);
    const sample = (x: number, y: number) => Array.from(ctx.getImageData(x * dpr, y * dpr, 1, 1).data);
    return { width: canvas.width, height: canvas.height, dpr,
      paper: sample(50, 50), building: sample(250, 250), tower: sample(167, 180),
      roadCenter: sample(645, 202), roadEdge: sample(650, 207),
      font: (window as any).__probe.font, stage: (window as any).__probe.stageSize };
  });
  await expect.poll(async () => (await read()).building).toEqual([153, 148, 138, 255]);
  const state = await read();
  expect(state.paper).toEqual([204, 197, 184, 255]);
  expect(state.tower).toEqual([26, 25, 23, 255]);
  expect(state.roadCenter).toEqual([204, 197, 184, 255]);
  expect(state.roadEdge).toEqual([103, 99, 92, 255]);
  expect(state.width).toBe(800 * state.dpr);
  expect(state.height).toBe(800 * state.dpr);
  expect(state.font).toEqual(legacy.font);
  const box = (await map.boundingBox())!;
  await page.mouse.move(box.x + 250, box.y + 250, { steps: 5 });
  await expect(page.locator('#hover')).toHaveText('命中：工匠街区');
  await page.mouse.move(box.x + 50, box.y + 50);
  await expect(page.locator('#hover')).toHaveText('尚未命中街区');
  mkdirSync('artifacts/p1/probe', { recursive: true });
  await map.screenshot({ path: `artifacts/p1/probe/${info.project.name}.png` });
  await page.locator('#zoom').fill('1.5');
  await expect(page.locator('#metrics')).toContainText('1.5×');
  await page.mouse.move(box.x + 175, box.y + 175, { steps: 5 });
  await expect(page.locator('#hover')).toHaveText('命中：工匠街区');
  await page.locator('#zoom').fill('1');
  await page.setViewportSize({ width: 768, height: 1000 });
  await expect.poll(() => canvas.evaluate(c => (c as HTMLCanvasElement).width)).toBe(736 * state.dpr);
  // Mouse coordinates remain in CSS pixels after resizing.
  const resized = (await map.boundingBox())!;
  await page.mouse.move(resized.x + 250 * 736 / 800, resized.y + 250 * 736 / 800, { steps: 5 });
  await expect(page.locator('#hover')).toHaveText('命中：工匠街区');
  expect(errors).toEqual([]);
  writeFileSync(`artifacts/p1/probe/${info.project.name}.json`, JSON.stringify({ browser: browser.version(), ...state, errors }, null, 2) + '\n');
});
