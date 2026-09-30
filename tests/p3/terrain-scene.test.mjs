import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown } from '../../packages/core/dist/index.js';
import { buildMapScene, THEMES, pickScene } from '../../packages/map-scene/dist/index.js';

test('sea and river surfaces, bridge/pier picking and scene ownership', () => {
  const result = generateTown({ seed: 42, size: 24, coast: 'east', river: true }); assert.equal(result.ok, true);
  const town = result.town, before = JSON.stringify(town), scene = buildMapScene(town, THEMES.modern);
  const pick = p => pickScene(scene, { centerX: p.x, centerY: p.y, zoom: 3 }, 100, 100, 50, 50);
  const dock = town.terrain.docks[0], middle = path => ({ x: (path[0].x + path.at(-1).x) / 2, y: (path[0].y + path.at(-1).y) / 2 });
  assert.equal(pick(middle(dock.points)), dock.districtId);
  assert.ok(pick(middle(town.river.bridges[0].points)));
  assert.equal(pick({ x: town.bounds.maxX - 1, y: 0 }), null);
  assert.ok(scene.commands.filter(c => c.kind === 'polygon' && c.fill === THEMES.modern.water).length >= 2);
  scene.terrain.coast.water[0].x++; scene.terrain.coast.shoreline[0].y++;
  scene.terrain.waterfronts[0].roadId = 'changed'; scene.terrain.docks[0].points[0].x++;
  scene.river.surface[0].y++;
  assert.equal(JSON.stringify(town), before);
});
