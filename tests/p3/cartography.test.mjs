import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown } from '../../packages/core/dist/index.js';
import { buildMapScene, layoutCartography, layoutMapLabels, THEMES, formatMapDistance } from '../../packages/map-scene/dist/index.js';

const town = generateTown({ seed: 42, size: 24, river: true, coast: 'east' }).town;
const make = options => buildMapScene(town, THEMES.modern, { labels: true, cartography: options });
const view = { centerX: 13, centerY: -27, zoom: 2 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('grid lines stay aligned with world distances through pan and zoom', () => {
  const scene = make({ gridSize: 100 });
  for (const zoom of [0.02, 0.2, 1, 2, 10]) for (const centerX of [-101, 0, 37]) {
    const camera = { centerX, centerY: -27, zoom }, grid = layoutCartography(scene, camera, 800, 600).find(l => l.kind === 'grid');
    assert.ok(grid.commands.length < 45);
    for (const line of grid.commands) {
      const [a, b] = line.points, vertical = a.x === b.x;
      const coordinate = vertical ? centerX + (a.x - 400) / zoom : camera.centerY + (a.y - 300) / zoom;
      close(coordinate / grid.stepMeters, Math.round(coordinate / grid.stepMeters));
      assert.ok(a.x >= -1e-8 && a.x <= 800 && a.y >= -1e-8 && a.y <= 600);
      assert.ok(line.opacity < 0.5);
    }
  }
});

test('scale bar reports exact map distances at each zoom and respects metres per unit', () => {
  for (const metersPerUnit of [1, 5]) for (const zoom of [0.02, 0.2, 1, 2, 10, 40]) {
    const scene = make({ gridSize: 'auto', metersPerUnit }), camera = { ...view, zoom };
    const layers = layoutCartography(scene, camera, 800, 600), scale = layers.find(l => l.kind === 'scale'), grid = layers.find(l => l.kind === 'grid');
    close(scale.lengthPixels, scale.distanceMeters * zoom / metersPerUnit);
    assert.ok(scale.lengthPixels >= 60 && scale.lengthPixels <= 200 + 1e-7);
    assert.ok(grid.stepMeters * zoom / metersPerUnit >= 100 - 1e-7);
    assert.deepEqual(scale, layoutCartography(scene, { ...camera, centerX: 324, centerY: 741 }, 800, 600).find(l => l.kind === 'scale'));
  }
  assert.equal(formatMapDistance(2000), '2 km'); assert.equal(formatMapDistance(0.5), '0.5 m');
});

test('compass and scale fit small maps and reserve space from region labels', () => {
  const scene = make({});
  for (const [width, height] of [[320, 450], [800, 600], [1600, 900]]) {
    const layers = layoutCartography(scene, view, width, height), reserved = layers.filter(l => l.bounds);
    for (const layer of reserved) { const b = layer.bounds; assert.ok(b.minX >= 0 && b.minY >= 0 && b.maxX <= width && b.maxY <= height); }
    const [scale, compass] = reserved; assert.ok(scale.bounds.maxX < compass.bounds.minX);
    assert.equal(compass.commands.filter(c => c.kind === 'polygon').length, 16);
    const north = compass.commands.find(c => c.kind === 'text'); assert.equal(north.text, 'N');
    assert.ok(north.position.y < compass.commands[0].center.y);
    assert.deepEqual(compass, layoutCartography(scene, { centerX: 100, centerY: 100, zoom: 8 }, width, height).find(l => l.kind === 'compass'));
    const labels = layoutMapLabels(scene, view, width, height, (text, size) => text.length * size * 0.6);
    for (const label of labels) for (const layer of reserved) {
      const a = label.bounds, b = layer.bounds;
      assert.ok(a.maxX + 3 <= b.minX || b.maxX + 3 <= a.minX || a.maxY + 3 <= b.minY || b.maxY + 3 <= a.minY);
    }
  }
});

test('cartography is optional, independent of geometry, and bounded at extreme sizes', () => {
  const before = JSON.stringify(town), plain = buildMapScene(town), scene = make({});
  assert.equal(plain.cartography, undefined); assert.deepEqual(layoutCartography(plain, view, 800, 600), []);
  assert.deepEqual(layoutCartography(make({ grid: false, scale: false, compass: false }), view, 800, 600), []);
  assert.deepEqual(scene.commands, buildMapScene(town, THEMES.modern).commands);
  assert.equal(JSON.stringify(town), before);
  assert.equal(layoutCartography(scene, view, 100, 100).some(l => l.kind !== 'grid'), false);
  assert.ok(layoutCartography(scene, { ...view, zoom: 1e-10 }, 800, 600).every(l => l.commands.length <= 1024));
  for (const value of [0, -1, Infinity, NaN]) { assert.throws(() => make({ gridSize: value })); assert.throws(() => make({ metersPerUnit: value })); }
});
