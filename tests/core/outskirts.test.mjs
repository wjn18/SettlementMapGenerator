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

test('seed 160625217: waterfront residential districts retain occupied interiors and deterministic output', () => {
  const options = { seed: 160625217, size: 40, plaza: true, castle: true, walls: false, river: true, coast: 'east', harbor: true };
  const result = generateTown(options);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const town = result.town; validateTown(town);
  const vertices = new Map(town.vertices.map(v => [v.id, new Point(v.x, v.y)]));
  const residential = town.districts.filter(d => d.withinCity && ['Slum', 'CraftsmenWard', 'GateWard', 'MerchantWard', 'PatriciateWard'].includes(d.wardType));
  let land = 0, roofs = 0, occupied = 0;
  for (const d of residential) {
    land += new Polygon(d.boundary.map(id => vertices.get(id))).square;
    const buildings = town.buildings.filter(b => b.districtId === d.id);
    if (buildings.length) occupied++;
    roofs += buildings.reduce((sum, b) => sum + new Polygon(b.boundary.map(id => vertices.get(id))).square, 0);
  }
  assert.ok(occupied / residential.length > 0.95);
  assert.ok(roofs / land > 0.4, `residential roof coverage ${roofs / land}`);
  assert.equal(serializeTown(generateTown(options).town), serializeTown(town));
});


test('open planned frontage keeps roadside houses and leaves distant backyards empty', () => {
  const run = () => {
    const patch = { shape: rect(0, 0, 40, 40), withinCity: true };
    const model = { plannedLayout: true, context: new GenerationContext(42), streetWidth: (a, b) => a.x === 0 && b.x === 0 ? 3.8 : 0 };
    const ward = new Ward('CraftsmenWard', model, patch);
    const buildings = Array.from({ length: 16 }, (_, i) => rect(1 + i % 4 * 10, 1 + Math.floor(i / 4) * 10, 8, 8));
    ward.geometry = [...buildings]; ward.filterOutskirts();
    assert.ok(buildings.filter((_, i) => i % 4 === 0).every(b => ward.geometry.includes(b)));
    assert.ok(buildings.filter((_, i) => i % 4 === 3).every(b => !ward.geometry.includes(b)));
    return ward.geometry;
  };
  assert.deepEqual(run(), run());
});
