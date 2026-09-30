import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown, validateTown, serializeTown, deserializeTown, polygonTouchesRiver, distanceToPath } from '../../packages/core/dist/index.js';

function generate(options) { const result = generateTown(options); assert.equal(result.ok, true, JSON.stringify(result)); return result.town; }
for (const seed of [352656828, 1, 42, 12345]) for (const size of [6, 15, 40]) test(`river ${seed}/${size}: geometry, repeatability and roundtrip`, () => {
  const options = { seed, size, castle: true, plaza: true, walls: true };
  const dry = generate(options), wet = generate({ ...options, river: true });
  validateTown(wet);
  assert.deepEqual(deserializeTown(serializeTown(wet)), wet);
  assert.equal(serializeTown(wet), serializeTown(generate({ ...options, river: true })));
  assert.deepEqual(wet.districts, dry.districts);
  assert.deepEqual(wet.roads, dry.roads);
  assert.ok(wet.buildings.length < dry.buildings.length);
  const index = new Map(wet.vertices.map(v => [v.id, v]));
  for (const b of [...wet.buildings, ...wet.features]) assert.equal(polygonTouchesRiver(b.boundary.map(id => index.get(id)), wet.river), false);
  for (const wall of wet.walls) for (let i = 0; i < wall.boundary.length; i++) if (wall.activeSegments[i]) {
    const a = index.get(wall.boundary[i]), b = index.get(wall.boundary[(i + 1) % wall.boundary.length]);
    for (let j = 0; j <= 10; j++) assert.ok(distanceToPath({ x: a.x + (b.x - a.x) * j / 10, y: a.y + (b.y - a.y) * j / 10 }, wet.river.centerline) >= wet.river.width / 2);
  }
  // Small towns can have a river that misses the existing road network.
  // Every road sample over water must still be covered by a bridge deck.
  for (const road of wet.roads) for (let i = 1; i < road.vertexIds.length; i++) {
    const a = index.get(road.vertexIds[i - 1]), b = index.get(road.vertexIds[i]);
    const steps = Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) / (wet.river.width / 4));
    for (let j = 0; j <= steps; j++) {
      const p = { x: a.x + (b.x - a.x) * j / steps, y: a.y + (b.y - a.y) * j / steps };
      if (distanceToPath(p, wet.river.centerline) < wet.river.width / 2)
        assert.ok(wet.river.bridges.some(bridge => distanceToPath(p, bridge.points) < bridge.width / 2), 'wet road is covered by a bridge');
    }
  }
  for (const bridge of wet.river.bridges) {
    assert.ok(wet.roads.some(r => r.id === bridge.roadId));
    assert.ok(bridge.points.length >= 2);
    for (const point of [bridge.points[0], bridge.points.at(-1)]) assert.ok(distanceToPath(point, wet.river.centerline) >= wet.river.width / 2, 'bridge endpoints reach land');
  }
  const off = generate({ ...options, river: false });
  delete off.request.river;
  assert.deepEqual(off, dry);
});

test('unwalled river maps and strict optional river validation', () => {
  const town = generate({ seed: 352656828, size: 40, walls: false, castle: false, river: true });
  validateTown(town); assert.equal(town.walls.length, 0);
  for (const modify of [
    t => t.river.width = -1, t => t.river.centerline[0].x = NaN, t => t.river.centerline = [],
    t => t.river.bridges[0].roadId = 'missing', t => t.request.river = false, t => delete t.river,
    t => t.river.extra = 1, t => t.river.bridges[0].width = 0,
  ]) { const bad = structuredClone(town); modify(bad); assert.throws(() => validateTown(bad)); }
  assert.equal(generateTown({ seed: 42, size: 15, river: 'yes' }).ok, false);
});
