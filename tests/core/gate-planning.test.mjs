import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown, generateTownSteps, validateTown, serializeTown, deserializeTown } from '../../packages/core/dist/index.js';
import { planGateApproaches, validateGeneratedGates } from '../../packages/core/dist/gate-planning.js';
import { rebuildCityFortifications } from '../../packages/core/dist/fortifications.js';
import { Point, Polygon } from '../../packages/core/dist/geometry.js';
import { intersection } from '../../packages/core/dist/terrain-geometry.js';

function inspect(town, scale = 4) {
  const v = new Map(town.vertices.map(p => [p.id, p])), report = [];
  for (const wall of town.walls) for (const gate of town.gates.filter(g => g.wallId === wall.id)) {
    const n = wall.boundary.length, i = wall.boundary.indexOf(gate.vertexId);
    let l = i, r = i, width = 0, steps = 0;
    const d = (a, b) => Math.hypot(v.get(a).x - v.get(b).x, v.get(a).y - v.get(b).y);
    const ids = new Set([gate.vertexId]);
    while (!wall.activeSegments[(l + n - 1) % n]) { assert.ok(steps++ < n); const j = (l + n - 1) % n; width += d(wall.boundary[l], wall.boundary[j]); l = j; ids.add(wall.boundary[l]); }
    while (!wall.activeSegments[r]) { assert.ok(steps++ < n); const j = (r + 1) % n; width += d(wall.boundary[r], wall.boundary[j]); r = j; ids.add(wall.boundary[r]); }
    assert.equal(town.gates.filter(g => g.wallId === wall.id && ids.has(g.vertexId)).length, 1, 'one gate per physical opening');
    const limits = wall.kind === 'city' ? [2, 5] : [1.5, 3];
    assert.ok(width >= limits[0] * scale - 1e-4 && width <= limits[1] * scale + 1e-4, `bounded ${wall.kind} opening ${width}`);
    const a = v.get(wall.boundary[l]), b = v.get(wall.boundary[r]), p = v.get(gate.vertexId), angles = [];
    for (const road of town.roads) for (let j = 0; j < road.vertexIds.length; j++) if (road.vertexIds[j] === gate.vertexId) {
      for (const k of [j - 1, j + 1].filter(k => k >= 0 && k < road.vertexIds.length)) {
        const q = v.get(road.vertexIds[k]), dot = Math.abs((q.x - p.x) * (b.x - a.x) + (q.y - p.y) * (b.y - a.y));
        const angle = Math.acos(Math.min(1, dot / Math.hypot(q.x - p.x, q.y - p.y) / Math.hypot(b.x - a.x, b.y - a.y))) * 180 / Math.PI;
        assert.ok(angle >= 75 - 1e-4, `road ${road.id} approaches gate ${gate.id} at ${angle} degrees`); angles.push(angle);
        assert.ok(road.width + .5 * scale <= width + 1e-4, 'road fits the gate');
      }
    }
    assert.ok(angles.length > 0, 'every gate belongs to the road graph');
    report.push({ id: gate.id, kind: wall.kind, width, angles, left: a, right: b });
  }
  return report;
}

function fixture(paths, size = 100, width = 3.8) {
  const envelope = new Polygon([[0, 0], [size, 0], [size, size], [0, size]].map(([x, y]) => new Point(x, y)));
  const streets = paths.map(path => new Polygon(path.map(([x, y]) => new Point(x, y))));
  const model = { cityEnvelope: envelope, streets, roads: [], roadWidths: new Map(streets.map(p => [p, width])), citadel: null };
  return { model, export() {
    const vertices = [], ids = new Map();
    const id = p => { if (!ids.has(p)) { ids.set(p, `v${vertices.length}`); vertices.push({ id: ids.get(p), x: p.x, y: p.y }); } return ids.get(p); };
    const wall = { id: 'wall', kind: 'city', boundary: envelope.map(id), activeSegments: envelope.map(() => true), gateIds: [], towerVertexIds: [] };
    const town = { vertices, walls: [wall], gates: [], entrances: [], roads: streets.map((p, i) => ({ id: `r${i}`, kind: 'street', vertexIds: p.map(id), width })), districts: [], buildings: [], features: [] };
    rebuildCityFortifications(town, [], envelope); return town;
  } };
}

test('an oblique road bends to a normal throat while its remote endpoints stay in place', () => {
  const f = fixture([[[-30, 10], [30, 85]]]), path = f.model.streets[0], ends = [path[0], path.at(-1)];
  planGateApproaches(f.model, [], []);
  assert.equal(path[0], ends[0]); assert.equal(path.at(-1), ends[1]);
  const gates = inspect(f.export(), 1); assert.equal(gates.length, 1);
  assert.ok(gates[0].angles.every(a => Math.abs(90 - a) < 1e-4));
  assert.ok(Math.abs(gates[0].width - 4.8) < 1e-5);
});

test('two close gates remain separate and keep an eight-metre wall pier', () => {
  const f = fixture([[[-20, 49], [20, 49]], [[-20, 50], [20, 50]]]);
  planGateApproaches(f.model, [], []);
  const town = f.export(), gates = inspect(town, 1).sort((a, b) => a.left.y - b.left.y);
  assert.equal(gates.length, 2);
  const bounds = gates.map(g => [Math.min(g.left.y, g.right.y), Math.max(g.left.y, g.right.y)]);
  assert.ok(bounds[1][0] - bounds[0][1] >= 2 - 1e-5);
  validateGeneratedGates(town);
});

test('a short gate approach cannot overshoot its anchor and double back',()=>{
  const f=fixture([[[-.5,50],[20,55]]]),path=f.model.streets[0];
  planGateApproaches(f.model,[],[]);inspect(f.export(),1);
  for(let i=1;i<path.length-1;i++){
    const a=path[i-1],p=path[i],b=path[i+1];
    const dot=((p.x-a.x)*(b.x-p.x)+(p.y-a.y)*(b.y-p.y))/Math.hypot(p.x-a.x,p.y-a.y)/Math.hypot(b.x-p.x,b.y-p.y);
    assert(Math.acos(Math.max(-1,Math.min(1,dot)))<Math.PI*5/6,'a throat overshoots into a hairpin');
  }
});

test('an unfit pair of gates is rejected instead of making one wide opening', () => {
  const f = fixture([[[-5, 2], [5, 2]], [[-5, 3], [5, 3]]], 6);
  assert.throws(() => planGateApproaches(f.model, [], []), /separate bounded gates/);
});

test('an over-wide road cannot silently exceed the gate maximum', () => {
  const f = fixture([[[-10, 50], [20, 50]]], 100, 8);
  assert.throws(() => planGateApproaches(f.model, [], []), /too wide/);
});

test('a dead end touching the wall does not become a through gate', () => {
  const f = fixture([[[0, 50], [20, 50]]]);
  planGateApproaches(f.model, [], []); assert.equal(f.export().gates.length, 0);
});

test('a road split into separate inside and outside paths keeps one shared gate node', () => {
  const f = fixture([[[-20, 30], [0, 50]], [[0, 50], [20, 70]]]);
  planGateApproaches(f.model, [], []);
  const town = f.export(), gates = inspect(town, 1); assert.equal(gates.length, 1);
  const gate = town.gates[0]; assert.equal(town.roads.filter(r => r.vertexIds.includes(gate.vertexId)).length, 2);
});

test('gate planning runs before any building geometry', () => {
  const iterator = generateTownSteps({ seed: 645382103, size: 12, walls: true, castle: true, plaza: true }), stages = [];
  let result; for (;;) { const s = iterator.next(); if (s.done) { result = s.value; break; } stages.push(s.value); }
  assert.equal(result.ok, true);
  const final = stages.filter(s => s.attempt === result.town.resolved.attempts).map(s => s.stage);
  assert.ok(final.indexOf('createWards') < final.indexOf('planGateApproaches'));
  assert.ok(final.indexOf('planGateApproaches') < final.indexOf('buildGeometry'));
});

test('a main street keeps its width while the castle throat becomes a narrow branch', () => {
  const a = new Point(0, 0), gate = new Point(25, 0), b = new Point(50, 0);
  const parcel = new Polygon([a, gate, b, new Point(50, 50), new Point(0, 50)]), saved = JSON.stringify(parcel);
  const wall = { shape: new Polygon(parcel), segments: parcel.map(() => true), gates: [gate], buildTowers() {} };
  const road = new Polygon([a, gate, b]);
  const model = { cityEnvelope: null, citadel: { ward: { wall } }, patches: [], streets: [road], roads: [], arteries: [road], gates: [gate], roadWidths: new Map([[road, 3.8]]) };
  planGateApproaches(model, [], []);
  assert.equal(JSON.stringify(parcel), saved, 'the keep parcel is unchanged');
  assert.ok(model.streets.some(p => model.roadWidths.get(p) === 3.8 && !p.includes(wall.gates[0])), 'remote main street retains its width');
  const throats = model.streets.filter(p => p.includes(wall.gates[0]));
  assert.ok(throats.length); assert.ok(throats.every(p => model.roadWidths.get(p) <= 2));
  assert.ok(model.streets.every(p => !p.some((point, i) => i > 0 && i < p.length - 1 && p[i - 1] === p[i + 1])), 'no out-and-back duplicate road faces');
});

for (const options of [
  { seed: 645382103, size: 12 }, { seed: 7, size: 6 }, { seed: 12345, size: 40 },
  { seed: 42, size: 100 }, { seed: 1, size: 6, river: true },
  { seed: 42, size: 24, coast: 'east', river: true }, { seed: 42, size: 40, walls: false },
]) test(`bounded, separate, perpendicular generated gates ${JSON.stringify(options)}`, () => {
  const result = generateTown({ walls: true, castle: true, plaza: true, ...options }); assert.equal(result.ok, true, JSON.stringify(result.error));
  const town = result.town; validateTown(town); inspect(town);
  assert.deepEqual(deserializeTown(serializeTown(town)), town);
  const vertices = new Map(town.vertices.map(v => [v.id, v]));
  for (const wall of town.walls) for (let i = 0; i < wall.boundary.length; i++) if (wall.activeSegments[i]) {
    const a = vertices.get(wall.boundary[i]), b = vertices.get(wall.boundary[(i + 1) % wall.boundary.length]);
    for (const road of town.roads) for (let j = 1; j < road.vertexIds.length; j++) {
      const hit = intersection(a, b, vertices.get(road.vertexIds[j - 1]), vertices.get(road.vertexIds[j]));
      assert.ok(!hit || hit.some(t => t < 1e-5 || t > 1 - 1e-5), `solid ${wall.kind} wall crosses ${road.id}`);
    }
  }
});
