import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown, renameTown, distanceToPath } from '../../packages/core/dist/index.js';
import { buildMapScene, THEMES, layoutMapLabels, fitViewport, pointInRing } from '../../packages/map-scene/dist/index.js';

const measure = (text, size) => Array.from(text).reduce((w, c) => w + size * (/[^\x00-\x7f]/.test(c) ? 1 : 0.56), 0);
const town = generateTown({ seed: 42, size: 24, coast: 'east', river: true, harbor: true, castle: true, plaza: true, walls: false }).town;
const vertices = new Map(town.vertices.map(v => [v.id, v]));
const city = town.districts.filter(d => d.withinCity).flatMap(d => d.boundary.map(id => vertices.get(id)));
const bounds = { minX: Math.min(...city.map(v => v.x)), minY: Math.min(...city.map(v => v.y)), maxX: Math.max(...city.map(v => v.x)), maxY: Math.max(...city.map(v => v.y)) };

test('shared curved labels stay on their own land, avoid each other and respond to zoom', () => {
  const before = JSON.stringify(town), scene = buildMapScene(town, THEMES.modern, { labels: true });
  const viewport = fitViewport(bounds, 960, 720, 90);
  const placed = layoutMapLabels(scene, viewport, 960, 720, measure);
  assert.ok(placed.length >= 4);
  assert.ok(placed.some(label => label.kind === 'region' && new Set(label.glyphs.map(g => g.angle)).size > 2));
  assert.deepEqual(placed, layoutMapLabels(scene, viewport, 960, 720, measure));
  const world = p => ({ x: viewport.centerX + (p.x - 480) / viewport.zoom, y: viewport.centerY + (p.y - 360) / viewport.zoom });
  for (const [i, label] of placed.entries()) {
    const b = label.bounds;
    assert.ok(b.minX >= 8 && b.maxX <= 952 && b.minY >= 8 && b.maxY <= 712);
    for (const other of placed.slice(i + 1)) {
      const c = other.bounds;
      assert.ok(b.maxX + 3 <= c.minX || c.maxX + 3 <= b.minX || b.maxY + 3 <= c.minY || c.maxY + 3 <= b.minY);
    }
    if (label.kind === 'city') continue;
    const region = town.atlas.regions.find(r => r.id === label.id);
    const ownLand = town.districts.filter(d => region.districtIds.includes(d.id)).map(d => d.boundary.map(id => vertices.get(id)));
    for (const glyph of label.glyphs) {
      const p = world(glyph);
      assert.ok(ownLand.some(ring => pointInRing(ring, p)));
      assert.equal(pointInRing(town.river.surface, p), false);
      assert.equal(pointInRing(town.terrain.coast.water, p), false);
      assert.ok(town.river.bridges.every(b => distanceToPath(p, b.points) > b.width / 2));
    }
  }
  const zoomedOut = layoutMapLabels(scene, { ...viewport, zoom: viewport.zoom * 0.2 }, 960, 720, measure);
  assert.ok(zoomedOut.length < placed.length);
  assert.ok(zoomedOut.some(l => l.id === 'city-name'));
  assert.equal(JSON.stringify(town), before);
  scene.labels[1].candidates[0].center.x += 100;
  assert.equal(JSON.stringify(town), before);
  assert.equal(buildMapScene(town, THEMES.modern).labels, undefined);
});

test('long Unicode titles remain visible on narrow viewports and retain their full name', () => {
  const name = '雾'.repeat(64), scene = buildMapScene(renameTown(town, 'city', name), THEMES.modern, { labels: true });
  const placed = layoutMapLabels(scene, fitViewport(bounds, 320, 600, 40), 320, 600, measure);
  const title = placed.find(l => l.id === 'city-name');
  assert.ok(title); assert.equal(title.text, name); assert.ok(title.fontSize >= 14);
  assert.ok(title.glyphs.some(g => g.text === '…'));
  assert.ok(title.bounds.minX >= 8 && title.bounds.maxX <= 312);
});
