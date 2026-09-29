import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { generateTown, generateTownSteps, serializeTown, deserializeTown, validateTown, TownDataError, createVertexIndex, containsPoint, hasVertexId } from '../../packages/core/dist/index.js';
import { GenerationContext, Random, ResourceLimitError } from '../../packages/core/dist/context.js';
import { Model } from '../../packages/core/dist/model.js';
import { Polygon, Point } from '../../packages/core/dist/geometry.js';
import { createAlleys } from '../../packages/core/dist/wards.js';

const successful = options => { const result = generateTown(options); assert.equal(result.ok, true, JSON.stringify(result.error)); return result.town; };
const directory = new URL('../fixtures/p1/legacy/', import.meta.url);
for (const file of readdirSync(directory).filter(f => f.endsWith('.json.gz'))) {
  test(`determinism and lossless JSON topology: ${file}`, () => {
    const fixture = JSON.parse(gunzipSync(readFileSync(new URL(file, directory))));
    const options = { seed: fixture.seed, size: fixture.size }, town = successful(options);
    const json = serializeTown(town), parsed = deserializeTown(json);
    assert.equal(serializeTown(successful(options)), json);
    assert.deepEqual(parsed, town);
    assert.equal(serializeTown(parsed), json);
    assert.equal(town.resolved.attempts, fixture.attempts.length);
    const index = createVertexIndex(parsed), occurrences = new Map();
    for (const district of parsed.districts) for (const id of district.boundary) {
      assert.ok(index.has(id));
      if (!occurrences.has(id)) occurrences.set(id, []);
      occurrences.get(id).push(index.get(id));
    }
    const shared = [...occurrences.values()].filter(list => list.length > 1);
    assert.ok(shared.length > 0);
    for (const list of shared) assert.ok(list.every(v => v === list[0]));
    for (const wall of parsed.walls) for (const id of wall.gateIds) {
      const gate = parsed.gates.find(g => g.id === id);
      assert.equal(gate.wallId, wall.id);
      assert.ok(wall.boundary.includes(gate.vertexId));
      assert.ok(parsed.entrances.includes(gate.vertexId));
    }
    // Every shared edge retains the same two IDs after serialization.
    const edges = data => data.districts.flatMap(d => d.boundary.map((v, i) => [v, d.boundary[(i + 1) % d.boundary.length]].sort().join('/'))).sort();
    assert.deepEqual(edges(parsed), edges(town));
    assert.ok(town.features.every(f => ['grove', 'statue', 'fountain'].includes(f.kind)));
    assert.ok(town.buildings.every(b => !['Market', 'Park'].includes(town.districts.find(d => d.id === b.districtId).wardType)));
  });
}

test('Node import and generation do not access DOM, OpenFL, clocks or ambient randomness', () => {
  const url = new URL('../../packages/core/dist/index.js', import.meta.url).href;
  const script = `
    for (const key of ['window','document','navigator','openfl','performance']) Object.defineProperty(globalThis,key,{configurable:true,get(){throw new Error('Forbidden global: '+key)}});
    Math.random = () => { throw new Error('Ambient randomness'); };
    globalThis.Date = class { constructor(){throw new Error('Clock dependency')} static now(){throw new Error('Clock dependency')} };
    const {generateTown}=await import(${JSON.stringify(url)});
    if (!generateTown({seed:42,size:24}).ok) throw new Error('Generation failed');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('interleaved stage iterators, nested synchronous calls and caller mutations are isolated', () => {
  const options = { seed: 1, size: 15 }, other = { seed: 42, size: 40 };
  const expectedA = serializeTown(successful(options)), expectedB = serializeTown(successful(other));
  const a = generateTownSteps(options), b = generateTownSteps(other);
  options.seed = 999; // Options are snapshotted at iterator creation.
  let ra, rb, count = 0;
  do {
    if (!ra?.done) ra = a.next();
    if (!rb?.done) rb = b.next();
    if (++count === 3) { const unrelated = successful({ seed: 12345, size: 6 }); unrelated.vertices[0].x = NaN; unrelated.request.seed = -1; }
  } while (!ra.done || !rb.done);
  assert.equal(ra.value.ok, true); assert.equal(rb.value.ok, true);
  assert.equal(serializeTown(ra.value.town), expectedA);
  assert.equal(serializeTown(rb.value.town), expectedB);
  assert.ok(count > 6); // Includes seed 1's expected failed attempts.
});

test('all explicit feature combinations, boundary sizes and stable feature draws', () => {
  for (const size of [6, 40]) for (const plaza of [false, true]) for (const castle of [false, true]) for (const walls of [false, true]) {
    const town = successful({ seed: 42, size, plaza, castle, walls }); validateTown(town);
    assert.deepEqual([town.resolved.plaza, town.resolved.castle, town.resolved.walls], [plaza, castle, walls]);
    assert.equal(town.walls.some(w => w.kind === 'city'), walls);
    assert.equal(town.walls.some(w => w.kind === 'castle'), castle);
  }
  const auto = successful({ seed: 42, size: 15 });
  const explicit = successful({ seed: 42, size: 15, plaza: auto.resolved.plaza, castle: auto.resolved.castle, walls: auto.resolved.walls });
  explicit.request = auto.request;
  assert.equal(serializeTown(explicit), serializeTown(auto));
});

test('invalid inputs return typed errors and bounded retry exhaustion reports the failed stage', () => {
  for (const options of [null, [], {}, { seed: 0, size: 6 }, { seed: 2147483647, size: 6 }, { seed: NaN, size: 6 }, { seed: 1.1, size: 6 }, { seed: 1, size: 5 }, { seed: 1, size: 41 }, { seed: 1, size: Infinity }, { seed: 1, size: 6, walls: 'yes' }, { seed: 1, size: 6, castle: null }, { seed: 1, size: 6, maxAttempts: 0 }, { seed: 1, size: 6, maxAttempts: 101 }, { seed: 1, size: 6, typo: 1 }]) {
    const result = generateTown(options); assert.equal(result.ok, false); assert.equal(result.error.code, 'INVALID_OPTIONS'); assert.equal(result.error.attempts, 0);
  }
  const failure = generateTown({ seed: 1, size: 15, maxAttempts: 1 });
  assert.equal(failure.ok, false); assert.equal(failure.error.code, 'GENERATION_FAILED');
  assert.equal(failure.error.attempts, 1); assert.equal(failure.error.stage, 'buildWalls');
});

test('operation/depth budgets terminate and unexpected programming errors propagate', () => {
  const context = new GenerationContext(42, 0), model = new Model(context, 6, { plaza: true, castle: false, walls: true });
  assert.throws(() => model.build().next(), ResourceLimitError);
  assert.throws(() => new GenerationContext(42).geometry(50_001), ResourceLimitError);
  assert.throws(() => createAlleys(new GenerationContext(42), Polygon.rect(10, 10), 10, 0.5, 0.5, 0.04, true, 129), ResourceLimitError);
  const original = Model.prototype.buildGeometry;
  try {
    Model.prototype.buildGeometry = () => { throw new ResourceLimitError('test budget'); };
    assert.equal(generateTown({ seed: 42, size: 6 }).error.code, 'RESOURCE_LIMIT');
    Model.prototype.buildGeometry = () => { throw new TypeError('programming defect'); };
    assert.throws(() => generateTown({ seed: 42, size: 6 }), /programming defect/);
  } finally { Model.prototype.buildGeometry = original; }
});

test('JSON rejects broken versions, quantities, numbers, rings and references', () => {
  const town = successful({ seed: 42, size: 6 });
  const mutations = [
    t => t.schemaVersion = '2', t => t.vertices[1].id = t.vertices[0].id,
    t => t.vertices[0].x = null, t => t.vertices[0].x = Infinity,
    t => t.districts[0].boundary[0] = 'missing', t => t.districts[0].boundary = t.districts[0].boundary.slice(0, 2),
    t => t.districts[0].boundary.push(t.districts[0].boundary[0]), t => t.districts[0].boundary.reverse(),
    t => t.districts[0].wardType = '__proto__', t => t.buildings[0].districtId = 'missing',
    t => t.walls[0].activeSegments.pop(), t => t.gates[0].wallId = 'missing',
    t => t.walls[0].gateIds.push('missing'), t => t.entrances = [], t => t.roads[0].width = 0,
    t => t.resolved.seed++, t => t.bounds.maxX++, t => t.request.extra = 1,
    t => t.vertices = Array(250001).fill(t.vertices[0]),
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(town); mutate(copy);
    assert.throws(() => validateTown(copy), TownDataError);
    assert.throws(() => deserializeTown(JSON.stringify(copy)), TownDataError);
  }
  for (const text of ['{', 'null', '[]', '{}']) assert.throws(() => deserializeTown(text), TownDataError);
});

test('geometry containment differs from ID membership; cuts preserve area and shared intersections', () => {
  const town = successful({ seed: 42, size: 6 }), ring = town.districts[0].boundary;
  const index = createVertexIndex(town), p = index.get(ring[0]);
  assert.equal(hasVertexId(ring, p.id), true);
  assert.equal(hasVertexId(ring, 'different-id'), false);
  assert.equal(containsPoint(town, ring, { x: p.x, y: p.y }), true);
  assert.equal(containsPoint(town, ring, { x: 1e6, y: 1e6 }), false);
  const rect = Polygon.rect(10, 8), halves = rect.cut(new Point(0, -10), new Point(0, 10));
  assert.equal(halves.length, 2); assert.equal(halves[0].square + halves[1].square, rect.square);
  const shared = halves[0].filter(p => halves[1].includes(p)); assert.equal(shared.length, 2);
  assert.equal(rect.shrinkEq(1).square, 48);
  const random = new Random(1); assert.deepEqual([random.next(), random.next(), random.next()], [48271, 182605794, 1291394886]);
});
