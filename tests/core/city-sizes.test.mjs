import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown, serializeTown, deserializeTown, estimatePopulation } from '../../packages/core/dist/index.js';
import { GenerationContext, ResourceLimitError } from '../../packages/core/dist/context.js';
import { Point, Polygon, containsPolygon } from '../../packages/core/dist/geometry.js';
import { normalizeOptions } from '../../packages/core/dist/options.js';
import { isRegularCastleFootprint } from '../../packages/core/dist/castle.js';

for (const size of [41, 60, 80, 100]) for (const water of [false, true])
test(`expanded size ${size}, estuary=${water}: usable districts, regular castle and lossless data`, () => {
  const options = { seed: 42, size, castle: true, plaza: true, walls: false, ...(water ? { coast: 'east', river: true } : {}) };
  const result = generateTown(options); assert.equal(result.ok, true, JSON.stringify(result.error));
  const town = result.town, json = serializeTown(town);
  assert.deepEqual(deserializeTown(json), town);
  assert.equal(serializeTown(generateTown(options).town), json);
  assert.equal(town.resolved.size, size);
  if (!water) assert.equal(town.districts.filter(d => d.withinCity).length, size + 1);
  if (size === 100) assert.ok(town.districts.filter(d => d.withinCity).length >= 100);
  const index = new Map(town.vertices.map(v => [v.id, new Point(v.x, v.y)]));
  const polygon = ids => new Polygon(ids.map(id => index.get(id)));
  const districts = new Map(town.districts.map(d => [d.id, polygon(d.boundary)]));
  for (const b of [...town.buildings, ...town.features]) assert(containsPolygon(districts.get(b.districtId), polygon(b.boundary)), b.id);
  const castle = town.districts.find(d => d.wardType === 'Castle');
  const buildings = town.buildings.filter(b => b.districtId === castle.id);
  assert.equal(buildings.length, 1);
  assert(isRegularCastleFootprint(polygon(buildings[0].boundary), districts.get(castle.id).shrinkEq(16)));
  const population = estimatePopulation(town);
  assert.ok(population.total.residents > 0); assert.equal(population.city.buildingCount + population.outskirts.buildingCount, town.buildings.length);
});

test('100 base districts also support every explicit landmark/wall combination', () => {
  for (const castle of [false, true]) for (const plaza of [false, true]) for (const walls of [false, true]) {
    const result = generateTown({ seed: 42, size: 100, castle, plaza, walls });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    const count = result.town.districts.filter(d => d.withinCity).length;
    // Walled towns can also develop additional gate districts outside the wall.
    if (walls) assert.ok(count >= 100 + Number(castle));
    else assert.equal(count, 100 + Number(castle));
    assert.deepEqual(deserializeTown(serializeTown(result.town)), result.town);
  }
});

test('large-city plans recover former difficult sites within explicit limits', () => {
  const options = { seed: 682063530, size: 100, castle: true, plaza: true, walls: true };
  const short = generateTown({ ...options, maxAttempts: 20 });
  assert.equal(short.ok, true); assert.ok(short.town.resolved.attempts <= 20);
  const result = generateTown(options); assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.town.request.maxAttempts, 40); assert.ok(result.town.resolved.attempts <= 40);
});

test('larger geometry budgets remain finite and enforce their boundary', () => {
  const context = new GenerationContext(42, 2_000_000, 312_500);
  context.geometry(312_500); assert.throws(() => context.geometry(), ResourceLimitError);
  assert.throws(() => new GenerationContext(42).geometry(50_001), ResourceLimitError);
  assert.throws(() => new GenerationContext(42, 0, 312_500).step(), ResourceLimitError);
});


test('size normalization supports 100 parcels with bounded attempt defaults', () => {
  for (const size of [6, 12, 24, 40, 60, 80, 100]) {
    const options = normalizeOptions({ seed: 42, size });
    assert.equal(options.size, size); assert.equal(options.maxAttempts, size > 40 ? 40 : 20);
    assert.equal(normalizeOptions({ seed: 42, size, maxAttempts: 7 }).maxAttempts, 7);
  }
  for (const size of [5, 101, 12.5]) assert.throws(() => normalizeOptions({ seed: 42, size }));
});
