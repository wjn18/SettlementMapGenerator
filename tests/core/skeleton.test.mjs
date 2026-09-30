import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown, generateTownSteps, validateTown, polygonTouchesRiver, estimatePopulation } from '../../packages/core/dist/index.js';
import { GenerationContext } from '../../packages/core/dist/context.js';
import { SkeletonModel } from '../../packages/core/dist/skeleton.js';
import { buildTerrainTown } from '../../packages/core/dist/terrain.js';
import { Point, Polygon } from '../../packages/core/dist/geometry.js';

for (const wet of [false, true]) test(`reserve through routes before urban growth and build walls afterward, water=${wet}`, () => {
  const context = new GenerationContext(42), features = { castle: true, plaza: true, walls: false };
  const model = new SkeletonModel(context, 100, features);
  const request = { seed: 42, size: 100, ...features, maxAttempts: 20, ...(wet ? { coast: 'east', river: true } : {}) };
  const steps = buildTerrainTown(model, request, 1);
  let before, guides, subdivided = false;
  for (;;) {
    const next = steps.next(); if (next.done) break;
    if (next.value === 'planRoadSkeleton') {
      before = model.patches.filter(p => p.withinCity).length;
      guides = JSON.stringify(model.guides);
      assert.ok(model.guides.length >= 5);
      assert.ok(model.guides.every(g => g.path[0] !== g.path.at(-1)), 'no mandatory closed ring');
      assert.equal(new Set(model.guides.slice(1).map(g => g.path[0])).size, model.guides.length - 1, 'branches join at distinct transport nodes');
      assert.ok(before < 30); assert.ok(model.patches.every(p => !p.ward || p.ward.geometry.length === 0));
    }
    if (next.value === 'subdivideDistricts') {
      assert.ok(before < model.patches.filter(p => p.withinCity).length);
      assert.equal(model.patches.filter(p => p.withinCity).length, 101);
      assert.equal(JSON.stringify(model.guides), guides);
      assert.ok(model.patches.filter(p => !p.withinCity).length > 0, 'growth stops inside the rural envelope');
      assert.equal(model.wall, null);
      const outline = model.constructor.findCircumference(model.inner);
      assert.ok(outline.some((p, i) => { const a = p.subtract(outline[(i + outline.length - 1) % outline.length]), b = outline[(i + 1) % outline.length].subtract(p); return a.x * b.y - a.y * b.x < -1e-5; }), 'growth has real recesses');
      subdivided = true; break;
    }
  }
  assert.ok(subdivided);
});

for (const water of [{}, { river: true }, { coast: 'east', river: true }, { coast: 'west' }]) test(`road hierarchy, building clearance and physical scale ${JSON.stringify(water)}`, () => {
  const result = generateTown({ seed: 42, size: 100, castle: true, plaza: true, walls: true, ...water });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const t = result.town; validateTown(t);
  const vertices = new Map(t.vertices.map(v => [v.id, new Point(v.x, v.y)]));
  const city = new Set(t.districts.filter(d => d.withinCity).map(d => d.id));
  const main = t.roads.filter(r => r.kind === 'street' && r.width >= 15);
  const local = t.roads.filter(r => r.kind === 'street' && r.width < 7);
  assert.ok(main.length >= 4); assert.ok(local.length > main.length);
  for (const building of t.buildings.filter(b => city.has(b.districtId))) {
    const ring = building.boundary.map(id => vertices.get(id));
    for (const road of main) assert.equal(polygonTouchesRiver(ring, { centerline: road.vertexIds.map(id => vertices.get(id)), width: road.width, bankWidth: 0 }), false, `building ${building.id} overlaps main road ${road.id}`);
  }
  // All urban road endpoints belong to a single exported road component.
  const links = new Map();
  for (const road of t.roads) for (let i = 1; i < road.vertexIds.length; i++) {
    const a = road.vertexIds[i - 1], b = road.vertexIds[i];
    if (!links.has(a)) links.set(a, new Set()); if (!links.has(b)) links.set(b, new Set());
    links.get(a).add(b); links.get(b).add(a);
  }
  const visited = new Set(), queue = [t.roads[0].vertexIds[0]];
  while (queue.length) { const id = queue.pop(); if (visited.has(id)) continue; visited.add(id); queue.push(...links.get(id)); }
  assert.equal(visited.size, links.size);
  const areas = t.buildings.filter(b => city.has(b.districtId)).map(b => new Polygon(b.boundary.map(id => vertices.get(id))).square).sort((a, b) => a - b);
  assert.ok(areas[Math.floor(areas.length / 2)] > 80); assert.ok(areas.length > 500 && areas.length < 5000);
  assert.ok(t.districts.filter(d => d.withinCity && d.wardType === 'Slum').length < 25);
  const population = estimatePopulation(t);
  assert.equal(population.city.residents, Math.round(population.city.urbanAreaM2 / 100));
  assert.ok(population.city.urbanAreaM2 > 400_000);
});

test('public progress exposes planning before subdivision and building geometry', () => {
  const iterator = generateTownSteps({ seed: 42, size: 24, river: true, castle: true });
  const stages = []; let result;
  for (;;) { const next = iterator.next(); if (next.done) { result = next.value; break; } stages.push(next.value); }
  assert.equal(result.ok, true);
  const last = stages.filter(s => s.attempt === result.town.resolved.attempts).map(s => s.stage);
  assert.ok(last.indexOf('planRoadSkeleton') < last.indexOf('subdivideDistricts'));
  assert.ok(last.indexOf('subdivideDistricts') < last.indexOf('buildWalls'));
  assert.ok(last.indexOf('buildWalls') < last.indexOf('buildGeometry'));
});

for (const walls of [false, true]) test(`shore road references survive connectivity repairs, walls=${walls}`, () => {
  const result = generateTown({ seed: 352656828, size: 100, coast: 'east', castle: true, plaza: true, walls });
  assert.equal(result.ok, true, JSON.stringify(result.error)); validateTown(result.town);
  assert.ok(result.town.districts.filter(d => d.withinCity).length >= 100);
  for (const frontage of result.town.terrain.waterfronts) assert.ok(result.town.roads.some(r => r.id === frontage.roadId));
});

for (const seed of [1, 42, 12345]) test(`walls enclose the older core and leave later road frontage outside, seed=${seed}`, () => {
  const result = generateTown({ seed, size: 100, walls: true, castle: true, plaza: true });
  assert.equal(result.ok, true);
  const city = result.town.districts.filter(d => d.withinCity && d.wardType !== 'Castle');
  assert.equal(city.length, 100);
  assert.ok(city.some(d => d.withinWalls)); assert.ok(city.some(d => !d.withinWalls));
  const wall = result.town.walls.find(w => w.kind === 'city'), points = new Map(result.town.vertices.map(v => [v.id, new Point(v.x, v.y)]));
  const outline = new Polygon(wall.boundary.map(id => points.get(id)));
  assert.ok(outline.some((p, i) => { const a = p.subtract(outline[(i + outline.length - 1) % outline.length]), b = outline[(i + 1) % outline.length].subtract(p); return a.x * b.y - a.y * b.x < -1e-5; }));
});
