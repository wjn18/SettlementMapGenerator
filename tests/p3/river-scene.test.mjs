import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown, distanceToPath } from '../../packages/core/dist/index.js';
import { buildMapScene, THEMES, pickScene } from '../../packages/map-scene/dist/index.js';

test('river scene uses theme water, excludes water from picking, and owns its data', () => {
  const result = generateTown({ seed: 352656828, size: 40, river: true, castle: true, plaza: true, walls: true });
  assert.equal(result.ok, true);
  const town = result.town, before = JSON.stringify(town), scene = buildMapScene(town, THEMES.june, { districtColors: true });
  assert.ok(scene.commands.some(c => c.kind === 'polygon' && c.fill === THEMES.june.water && c.points.length === town.river.surface.length));
  // Bridges remain pickable; use an open-water sample away from their decks.
  const point = town.river.centerline.find(p => town.river.bridges.every(b => distanceToPath(p, b.points) > b.width));
  assert.ok(point);
  assert.equal(pickScene(scene, { centerX: point.x, centerY: point.y, zoom: 1 }, 100, 100, 50, 50), null);
  assert.deepEqual(scene, buildMapScene(town, THEMES.june, { districtColors: true }));
  scene.river.centerline[0].x += 10; scene.river.bridges[0].points[0].x += 10;
  assert.equal(JSON.stringify(town), before);
});
