import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown, validateTown, serializeTown } from '../../packages/core/dist/index.js';
import { GenerationContext } from '../../packages/core/dist/context.js';
import { Point, Polygon } from '../../packages/core/dist/geometry.js';
import { Ward } from '../../packages/core/dist/wards.js';

const rect = (x, y, w, h) => new Polygon([
  new Point(x, y), new Point(x + w, y), new Point(x + w, y + h), new Point(x, y + h),
]);

function fringeBlock(streets) {
  const patch = { shape: rect(0, 0, 40, 40), withinCity: true };
  const context = new GenerationContext(42);
  const model = {
    context, gates: [], arteries: streets(patch.shape),
    getNeighbour: () => ({ withinCity: false }),
    patchByVertex: () => [patch, { withinCity: false }],
  };
  const ward = new Ward('Slum', model, patch);
  const buildings = Array.from({ length: 16 }, (_, i) => rect(1 + i % 4 * 10, 1 + Math.floor(i / 4) * 10, 8, 8));
  ward.geometry = [...buildings];
  ward.filterOutskirts();
  return { ward, buildings, state: context.random.state };
}

test('a complete street perimeter preserves the block interior in either street direction', () => {
  for (const reverse of [false, true]) {
    const { ward, buildings } = fringeBlock(shape => {
      const ring = [...shape, shape[0]];
      return [new Polygon(reverse ? ring.reverse() : ring)];
    });
    assert.deepEqual(ward.geometry, buildings, 'city-edge vertices must not hollow out a developed block');
  }
});

test('visiting every corner is not a street perimeter; open outskirts still thin and consume the same random stream', () => {
  const closed = fringeBlock(shape => [new Polygon([...shape, shape[0]])]);
  const open = fringeBlock(([a, b, c, d]) => [new Polygon([a, new Point(20, -10), b, c, d, a])]);
  assert.ok(open.ward.geometry.length < open.buildings.length, 'the missing boundary street leaves a real outskirts block');
  assert.equal(closed.state, open.state, 'preserving buildings must not reshuffle later districts');
});

// Independent point-in-polygon sampling of the central 40% of the bounding box.
function inside(p, ring) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

test('seed 160625217: Market Quarter 2 has occupied interiors, valid geometry and deterministic output', () => {
  const options = { seed: 160625217, size: 40, plaza: true, castle: true, walls: false, river: true, coast: 'east', harbor: true };
  const result = generateTown(options);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const town = result.town;
  validateTown(town);
  const vertices = new Map(town.vertices.map(v => [v.id, v]));
  const district = town.districts.find(d => d.id === 'd33');
  assert.equal(district.wardType, 'Slum');
  const ring = district.boundary.map(id => vertices.get(id));
  const buildings = town.buildings.filter(b => b.districtId === district.id).map(b => b.boundary.map(id => vertices.get(id)));
  const xs = ring.map(p => p.x), ys = ring.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let covered = 0, total = 0;
  for (let i = 0; i < 31; i++) for (let j = 0; j < 31; j++) {
    const p = { x: x0 + (x1 - x0) * (0.3 + 0.4 * i / 30), y: y0 + (y1 - y0) * (0.3 + 0.4 * j / 30) };
    if (inside(p, ring)) { total++; if (buildings.some(b => inside(p, b))) covered++; }
  }
  assert.ok(total > 0);
  assert.ok(covered / total > 0.65, `central building coverage ${covered / total}; formerly only 0.255`);
  assert.equal(town.atlas.cityName, 'Stonebridge');
  assert.equal(serializeTown(generateTown(options).town), serializeTown(town));
});
