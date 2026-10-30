import { test, expect } from '@playwright/test';
import { selectRenderer } from '../helpers/sidebar';
import { TERRAIN_GENERATOR_VERSION } from '../../packages/core/dist/index.js';

test('reported town keeps bounded gates and normal approaches across renderers', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?test=1&seed=645382103&size=12&castle=true&walls=true&plaza=true&river=false&coast=false&labels=false&grid=false&theme=parchment');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const saved = await page.evaluate(() => JSON.stringify((window as any).__playground.town));
  const report = await page.evaluate(() => {
    const t = (window as any).__playground.town, v = new Map<string, any>(t.vertices.map((p: any) => [p.id, p]));
    return { version: t.generatorVersion, gates: t.gates.map((g: any) => {
      const w = t.walls.find((w: any) => w.id === g.wallId), n = w.boundary.length, i = w.boundary.indexOf(g.vertexId);
      let l = i, r = i, steps = 0;
      while (!w.activeSegments[(l + n - 1) % n] && steps++ < n) l = (l + n - 1) % n;
      steps = 0; while (!w.activeSegments[r] && steps++ < n) r = (r + 1) % n;
      const a = v.get(w.boundary[l]), b = v.get(w.boundary[r]), p = v.get(g.vertexId), width = Math.hypot(b.x - a.x, b.y - a.y), angles: number[] = [];
      for (const road of t.roads) for (let j = 0; j < road.vertexIds.length; j++) if (road.vertexIds[j] === g.vertexId) {
        for (const k of [j - 1, j + 1].filter(k => k >= 0 && k < road.vertexIds.length)) {
          const q = v.get(road.vertexIds[k]); angles.push(Math.acos(Math.min(1, Math.abs((q.x - p.x) * (b.x - a.x) + (q.y - p.y) * (b.y - a.y)) / Math.hypot(q.x - p.x, q.y - p.y) / width)) * 180 / Math.PI);
        }
      }
      return { kind: w.kind, width, angles };
    }) };
  });
  expect(report.version).toBe(TERRAIN_GENERATOR_VERSION); expect(report.gates).toHaveLength(7);
  for (const gate of report.gates) {
    expect(gate.width).toBeGreaterThanOrEqual((gate.kind === 'city' ? 8 : 6) - 1e-4);
    expect(gate.width).toBeLessThanOrEqual((gate.kind === 'city' ? 20 : 12) + 1e-4);
    expect(gate.angles.length).toBeGreaterThan(0); expect(Math.min(...gate.angles)).toBeGreaterThanOrEqual(75 - 1e-4);
  }
  for (const kind of ['canvas', 'svg', 'openfl']) {
    await selectRenderer(page, kind);
    expect(await page.evaluate(() => JSON.stringify((window as any).__playground.town))).toBe(saved);
    await page.screenshot({ path: `artifacts/gate-planning/${info.project.name}-${kind}.png` });
  }
  expect(errors).toEqual([]);
});
