import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown, validateTown, serializeTown, deserializeTown, distanceToPath } from '../../packages/core/dist/index.js';
import { addRiver } from '../../packages/core/dist/river.js';
import { subtractRing } from '../../packages/core/dist/terrain-geometry.js';
import { Point, Polygon } from '../../packages/core/dist/geometry.js';

function generate(options) { const r = generateTown(options); assert.equal(r.ok, true, JSON.stringify(r)); return r.town; }
// Independent ray and proper-edge intersection checks, without generator clipping code.
function inside(p, ring) {
  let crossings = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + (p.y - a.y) * (b.x - a.x) / (b.y - a.y)) crossings++;
  }
  return crossings % 2 === 1;
}
const side = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function overlaps(a, b) {
  if (a.some(p => inside(p, b)) || b.some(p => inside(p, a))) return true;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const p = a[i], q = a[(i + 1) % a.length], r = b[j], s = b[(j + 1) % b.length];
    if (side(p,q,r) * side(p,q,s) < -1e-8 && side(r,s,p) * side(r,s,q) < -1e-8) return true;
  }
  return false;
}
const samplePath = points => points.slice(1).flatMap((b, i) => {
  const a = points[i], count = Math.max(2, Math.ceil(Math.hypot(a.x - b.x, a.y - b.y)));
  return Array.from({ length: count + 1 }, (_, j) => ({ x: a.x + (b.x - a.x) * j / count, y: a.y + (b.y - a.y) * j / count }));
});

test('land clipping conserves the area of disconnected banks and rejects polygon holes', () => {
  const rectangle = (x0, y0, x1, y1) => new Polygon([new Point(x0,y0),new Point(x1,y0),new Point(x1,y1),new Point(x0,y1)]);
  const land = rectangle(0, 0, 10, 10), river = rectangle(4, -2, 6, 12);
  const banks = subtractRing(land, river);
  assert.equal(banks.length, 2); assert.equal(banks.reduce((sum, p) => sum + p.square, 0), 80);
  assert.equal(subtractRing(land, rectangle(5,-2,12,12))[0].square, 50);
  assert.equal(subtractRing(land, rectangle(-2,-2,12,12)).length, 0);
  assert.throws(() => subtractRing(land, rectangle(4,4,6,6)), /holes/);
});

for (const size of [6, 24, 40]) for (const coast of ['east', 'south', 'west', 'north']) for (const river of [false, true])
test(`terrain ${size}/${coast}/river=${river}: land geometry, access and deterministic roundtrip`, () => {
  const options = { seed: 42, size, coast, river, castle: true, plaza: true, walls: true };
  const town = generate(options), index = new Map(town.vertices.map(v => [v.id, v]));
  const points = ids => ids.map(id => index.get(id));
  const districts = new Map(town.districts.map(d => [d.id, points(d.boundary)]));
  const surfaces = [town.terrain.coast.water, ...(town.river ? [town.river.surface] : [])];
  validateTown(town);
  const json = serializeTown(town);
  assert.equal(serializeTown(generate(options)), json);
  assert.deepEqual(deserializeTown(json), town);
  assert.equal(town.terrain.coast.side, coast);
  assert.ok(town.terrain.docks.length > 0);
  const graph = new Map();
  for (const road of town.roads) for (let i = 1; i < road.vertexIds.length; i++) {
    const a = road.vertexIds[i - 1], b = road.vertexIds[i];
    if (!graph.has(a)) graph.set(a, new Set()); if (!graph.has(b)) graph.set(b, new Set());
    graph.get(a).add(b); graph.get(b).add(a);
  }
  const reached = new Set(), queue = [graph.keys().next().value];
  while (queue.length) { const id = queue.pop(); if (reached.has(id)) continue; reached.add(id); queue.push(...graph.get(id)); }
  assert.equal(reached.size, graph.size, 'exported road network is connected');
  for (const district of town.districts) for (const water of surfaces) assert.equal(overlaps(points(district.boundary), water), false, 'district is entirely on land');
  for (const b of [...town.buildings, ...town.features]) {
    const ring = points(b.boundary), district = districts.get(b.districtId);
    for (const p of samplePath([...ring, ring[0]])) assert.ok(inside(p, district) || distanceToPath(p, [...district, district[0]]) < 1e-7, 'building stays inside its land parcel');
    for (const water of surfaces) assert.equal(overlaps(ring, water), false, 'no footprint crosses a water edge');
  }
  for (const road of town.roads) for (const p of samplePath(points(road.vertexIds))) {
    assert.equal(inside(p, town.terrain.coast.water), false, 'roads never enter the sea');
    if (town.river && inside(p, town.river.surface)) assert.ok(town.river.bridges.some(b => distanceToPath(p, b.points) < b.width / 2), 'water crossing has a bridge');
  }
  for (const bridge of town.river?.bridges ?? []) {
    const road = town.roads.find(r => r.id === bridge.roadId);
    assert.deepEqual(points(road.vertexIds).map(({ x, y }) => ({ x, y })), bridge.points);
    for (const id of [road.vertexIds[0], road.vertexIds.at(-1)]) assert.ok(town.roads.some(r => r.id !== road.id && r.vertexIds.includes(id)), 'bridge joins the road graph at both ends');
    for (const endpoint of [bridge.points[0], bridge.points.at(-1)]) for (const water of surfaces) assert.equal(inside(endpoint, water), false);
  }
  for (const wall of town.walls) for (let i = 0; i < wall.boundary.length; i++) if (wall.activeSegments[i]) {
    for (const p of samplePath(points([wall.boundary[i], wall.boundary[(i + 1) % wall.boundary.length]])))
      for (const water of surfaces) assert.equal(inside(p, water), false, 'solid wall stays out of water');
  }
  for (const dock of town.terrain.docks) {
    const road = town.roads.find(r => r.id === dock.roadId);
    assert.ok(distanceToPath(dock.points[0], points(road.vertexIds)) < 1e-7, 'pier attaches to the quay road');
    assert.equal(inside(dock.points[0], town.terrain.coast.water), false);
    assert.equal(inside(dock.points.at(-1), town.terrain.coast.water), true);
    assert.equal(town.districts.find(d => d.id === dock.districtId).wardType, 'Harbor');
    if (town.river) for (const p of samplePath(dock.points)) assert.equal(inside(p, town.river.surface), false, 'pier leaves the river mouth open');
  }
  if (town.river) assert.ok(inside(town.river.centerline.at(-1), town.terrain.coast.water), 'river reaches the sea');
});

test('harbor toggle, feature combinations, invalid options and strict terrain references', () => {
  for (const castle of [false, true]) for (const walls of [false, true]) for (const plaza of [false, true]) {
    const town = generate({ seed: 12345, size: 15, coast: 'auto', river: true, harbor: false, castle, walls, plaza });
    validateTown(town); assert.equal(town.terrain.docks.length, 0);
    assert.equal(town.walls.some(w => w.kind === 'castle'), castle); assert.equal(town.walls.some(w => w.kind === 'city'), walls);
  }
  const town = generate({ seed: 42, size: 24, coast: 'east', river: true });
  for (const edit of [
    t => t.terrain.coast.side = 'west', t => t.terrain.coast.water = [], t => t.terrain.coast.shoreline[0].x = Infinity,
    t => t.terrain.docks[0].roadId = 'missing', t => t.terrain.docks[0].districtId = 'missing',
    t => t.terrain.docks[0].width = -1, t => t.request.harbor = false, t => delete t.terrain,
    t => t.river.surface.reverse(), t => t.terrain.waterfronts[0].roadId = 'missing',
  ]) { const bad = structuredClone(town); edit(bad); assert.throws(() => validateTown(bad)); }
  for (const options of [{ coast: true }, { coast: 'ocean' }, { harbor: 'true' }]) assert.equal(generateTown({ seed: 42, size: 24, ...options }).ok, false);
});

test('legacy river JSON remains importable and disabled terrain preserves dry geometry', () => {
  const dry = generate({ seed: 42, size: 15 }), legacy = structuredClone(dry);
  legacy.request.river = true; addRiver(legacy);
  assert.deepEqual(deserializeTown(serializeTown(legacy)), legacy);
  const disabled = generate({ seed: 42, size: 15, coast: false, river: false, harbor: false });
  disabled.request = dry.request; assert.deepEqual(disabled, dry);
});
