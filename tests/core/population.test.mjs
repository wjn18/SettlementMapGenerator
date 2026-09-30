import test from 'node:test';
import assert from 'node:assert/strict';
import { estimatePopulation, generateTown, serializeTown, deserializeTown, getTownAtlas, renameTown, validateTown } from '../../packages/core/dist/index.js';

function fixture(wards = [['Ward', true]]) {
  const town = { schemaVersion: '1', generatorVersion: 'test', request: { seed: 42, size: 6, plaza: false, castle: false, walls: false, maxAttempts: 20 }, resolved: { seed: 42, size: 6, plaza: false, castle: false, walls: false, attempts: 1 }, vertices: [], districts: [], buildings: [], features: [], roads: [], walls: [], gates: [], entrances: [], center: { x: 0, y: 0 }, bounds: { minX: 0, minY: 0, maxX: (wards.length - 1) * 30 + 20, maxY: 20 } };
  const ring = points => points.map(([x, y]) => { const id = `v${town.vertices.length}`; town.vertices.push({ id, x, y }); return id; });
  wards.forEach(([wardType, withinCity], i) => {
    const x = i * 30, id = `d${i}`;
    town.districts.push({ id, boundary: ring([[x, 0], [x + 20, 0], [x + 20, 20], [x, 20]]), wardType, withinCity, withinWalls: false });
    town.buildings.push({ id: `b${i}`, districtId: id, boundary: ring([[x + 2, 2], [x + 12, 2], [x + 12, 12], [x + 2, 12]]) });
  });
  validateTown(town); return town;
}

function assertAdditive(estimate) {
  for (const key of ['residents', 'lower', 'upper']) {
    assert.equal(estimate.city[key], estimate.districts.reduce((sum, d) => sum + (d[key] ?? 0), 0) + estimate.unallocated[key]);
    assert.equal(estimate.city[key], estimate.regions.reduce((sum, r) => sum + r[key], 0) + estimate.unallocated[key]);
  }
  assert.deepEqual(estimate.total, estimate.city);
  for (const stats of [estimate.city, ...estimate.regions, ...estimate.districts.filter(d => d.withinCity)]) {
    assert.ok(stats.lower <= stats.residents && stats.residents <= stats.upper);
  }
}

test('400 square metres of urban land yield 4 residents, independent of residential floor assumptions', () => {
  const estimate = estimatePopulation(fixture());
  assert.deepEqual(estimate.total, { residents: 4, lower: 2, upper: 8, buildingCount: 1, footprintAreaM2: 100, urbanAreaM2: 400 });
  assert.equal(estimate.outskirts.residents, null);
  assert.equal(estimate.assumptions.personsPerHectare, 100);
  assert.deepEqual(estimate.assumptions.scenarioDensities, { sparse: 50, typical: 100, dense: 200 });
  assert.equal(estimate.modelVersion, '2'); assert.equal(estimate.assumptions.scope, 'city-only');
  assert.equal(estimate.sources[0].author, 'Eltjo Buringh'); assert.equal(estimate.sources[0].page, 8);
  assert.equal('occupancy' in estimate.assumptions, false); assert.equal('profile' in estimate.districts[0], false);
  assertAdditive(estimate);
});

test('density scenarios and squared distance conversion keep geometry and bounds stable', () => {
  const town = fixture(), before = serializeTown(town);
  for (const [density, residents] of [['sparse', 2], ['typical', 4], ['dense', 8]]) {
    const estimate = estimatePopulation(town, { density });
    assert.equal(estimate.total.residents, residents); assert.equal(estimate.total.lower, 2); assert.equal(estimate.total.upper, 8);
  }
  const scaled = estimatePopulation(town, { metersPerUnit: 2 });
  assert.equal(scaled.total.residents, 16); assert.equal(scaled.total.urbanAreaM2, 1600);
  assert.equal(serializeTown(town), before);
});

test('public urban space contributes land area, without allocating residents to parks, markets or rural farmland', () => {
  const town = fixture([['Ward', true], ['Slum', true], ['PatriciateWard', true], ['Harbor', true], ['MilitaryWard', true], ['Park', true], ['Market', true], ['Farm', false]]);
  town.features.push({ ...town.buildings[0], id: 'f0', kind: 'grove' });
  const result = estimatePopulation(town);
  assert.equal(result.total.urbanAreaM2, 2800); assert.equal(result.total.residents, 28);
  assert.equal(result.total.buildingCount, 7); assert.equal(result.total.footprintAreaM2, 700);
  assert.equal(result.outskirts.buildingCount, 1); assert.equal(result.outskirts.footprintAreaM2, 100);
  for (const d of result.districts.filter(d => ['Park', 'Market'].includes(d.wardType))) { assert.equal(d.residents, 0); assert.equal(d.allocationWeightM2, 0); }
  const farm = result.districts.find(d => d.wardType === 'Farm');
  assert.equal(farm.residents, null); assert.equal(farm.urbanAreaM2, 0);
  assertAdditive(result);
});

test('subdivision and building quantities do not change city totals; missing footprints leave an explicit unallocated total', () => {
  const town = fixture(), original = estimatePopulation(town), [a, b, c, d] = town.buildings[0].boundary;
  town.vertices.push({ id: 'split0', x: 7, y: 2 }, { id: 'split1', x: 7, y: 12 });
  town.buildings = [{ id: 'b0', districtId: 'd0', boundary: [a, 'split0', 'split1', d] }, { id: 'b1', districtId: 'd0', boundary: ['split0', b, c, 'split1'] }];
  const split = estimatePopulation(town);
  for (const key of ['residents', 'lower', 'upper', 'urbanAreaM2', 'footprintAreaM2']) assert.equal(split.total[key], original.total[key]);
  assert.equal(split.total.buildingCount, 2);
  town.buildings = [];
  const empty = estimatePopulation(town);
  assert.equal(empty.total.residents, 4); assert.deepEqual(empty.unallocated, { residents: 4, lower: 2, upper: 8 });
  assert.equal(empty.regions[0].residents, 0); assertAdditive(empty);
});

test('rounding keeps small district allocations additive and scenarios monotonic, with no wealth-specific coefficients', () => {
  const town = fixture([['Ward', true], ['Slum', true], ['PatriciateWard', true]]);
  const estimates = ['sparse', 'typical', 'dense'].map(density => estimatePopulation(town, { density, metersPerUnit: 0.71 }));
  for (const estimate of estimates) assertAdditive(estimate);
  for (let i = 0; i < 3; i++) {
    assert.equal(estimates[0].districts[i].residents, estimates[1].districts[i].lower);
    assert.equal(estimates[2].districts[i].residents, estimates[1].districts[i].upper);
  }
  const plain = estimatePopulation(town);
  assert.deepEqual(plain.districts.map(d => d.residents), [4, 4, 4]);
  town.districts.reverse();
  assert.deepEqual(Object.fromEntries(estimatePopulation(town).districts.map(d => [d.districtId, d.residents])), Object.fromEntries(plain.districts.map(d => [d.districtId, d.residents])));
});

test('maps with only countryside do not invent an urban population', () => {
  const estimate = estimatePopulation(fixture([['Farm', false]]));
  assert.equal(estimate.total.residents, 0); assert.equal(estimate.total.urbanAreaM2, 0);
  assert.equal(estimate.outskirts.residents, null); assertAdditive(estimate);
});

test('invalid assumptions, obsolete floor-model options and invalid geometry are rejected', () => {
  const town = fixture();
  for (const options of [{ density: 'unknown' }, { density: '__proto__' }, { occupancy: 0.9 }, { metersPerUnit: 0 }, { metersPerUnit: Infinity }, { metersPerUnit: 1e308 }, { metersPerUnit: 1e10 }, { metersPerUnit: 1e-308 }]) assert.throws(() => estimatePopulation(town, options), RangeError);
  const bad = structuredClone(town); bad.buildings[0].boundary[0] = 'missing'; assert.throws(() => estimatePopulation(bad));
});

for (const options of [{ seed: 42, size: 24 }, { seed: 1, size: 6 }, { seed: 12345, size: 40 }, { seed: 42, size: 24, river: true, coast: 'east', castle: true }, { seed: 42, size: 100, coast: 'east', river: true, harbor: true, castle: true, plaza: true, walls: false }])
test(`generated and legacy maps yield deterministic area estimates ${JSON.stringify(options)}`, () => {
  const result = generateTown(options); assert.equal(result.ok, true);
  const town = result.town, before = serializeTown(town), estimate = estimatePopulation(town);
  assert.deepEqual(estimatePopulation(deserializeTown(before)), estimate);
  assert.equal(serializeTown(town), before); assertAdditive(estimate);
  // Independent shoelace sum checks the denominator uses city parcels, not world bounds or buildings.
  const vertices = new Map(town.vertices.map(v => [v.id, v]));
  const urbanArea = town.districts.filter(d => d.withinCity).reduce((sum, d) => sum + d.boundary.reduce((twice, id, i) => {
    const a = vertices.get(id), b = vertices.get(d.boundary[(i + 1) % d.boundary.length]); return twice + a.x * b.y - b.x * a.y;
  }, 0) / 2, 0);
  assert.ok(Math.abs(estimate.city.urbanAreaM2 - urbanArea) < 1e-6);
  assert.equal(estimate.city.residents, Math.round(urbanArea / 100));
  if (options.size === 100) { assert.ok(estimate.city.residents > 4000); assert.equal(estimate.city.lower, Math.round(urbanArea / 200)); assert.equal(estimate.city.upper, Math.round(urbanArea / 50)); }
  const named = renameTown(town, getTownAtlas(town).regions[0].id, 'New Quarter'), renamed = estimatePopulation(named);
  assert.deepEqual(renamed.total, estimate.total); assert.equal(renamed.regions[0].name, 'New Quarter');
  renamed.regions[0].districtIds.push('missing'); renamed.sources[0].year = 0; renamed.assumptions.scenarioDensities.typical = 999;
  assert.deepEqual(estimatePopulation(town), estimate);
  delete town.atlas; const legacy = serializeTown(town);
  assert.deepEqual(estimatePopulation(town).total, estimate.total); assert.equal(serializeTown(town), legacy);
});
