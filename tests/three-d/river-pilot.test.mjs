import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deserializeTown, generateTown, serializeTown } from '@settlement/core';
import { buildRiverScene } from '@settlement/renderer-three';

const sample = deserializeTown(readFileSync(new URL('../../apps/playground/src/river-pilot/assets/river-town.json', import.meta.url), 'utf8'));
const before = serializeTown(sample);
const scene = buildRiverScene(sample);
const local = (town, p) => [(p.x - town.center.x) * .5, -(p.y - town.center.y) * .5];

// Intersect the final Float32 triangle buffers rather than trusting counts or recipe parameters.
function heights(mesh, id, [x, z]) {
  const part = mesh.spans.find(s => s.id === id);
  assert.ok(part, id);
  const result = [], v = mesh.positions;
  for (let k = part.start * 3; k < (part.start + part.count) * 3; k += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = v.subarray(k, k + 9);
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) continue;
    const a = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const b = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    if (Math.min(a, b, 1 - a - b) >= -.00001) result.push(a * ay + b * by + (1 - a - b) * cy);
  }
  return result;
}
test('all 170 source footprints and 58 roads survive assembly, repeatably', () => {
  assert.equal(sample.buildings.length, 170); assert.equal(sample.roads.length, 58);
  const vertices = new Map(sample.vertices.map(v => [v.id, v]));
  for (const house of sample.buildings) {
    const {start, count} = scene.town.spans.find(p => p.id === house.id);
    const buffer = scene.town.positions.subarray(start * 3, (start + count) * 3);
    const feet = [];
    for (let i = 0; i < buffer.length; i += 3) if (buffer[i + 1] === 0) feet.push([buffer[i], buffer[i + 2]]);
    for (const id of house.boundary) {
      const [x, z] = local(sample, vertices.get(id));
      assert.ok(feet.some(([a, b]) => Math.hypot(a - x, b - z) <= .00005), house.id + '/' + id);
    }
  }
  for (const road of sample.roads) assert.ok(scene.terrain.spans.some(p => p.id === road.id));
  assert.equal(serializeTown(sample), before);
  assert.deepEqual(buildRiverScene(sample).town.positions, scene.town.positions);
});
test('the three shallow seams on the Silverhaven cross street are paved out to the curb', () => {
  const {town} = generateTown({seed:1976396450, size:12, river:true, coast:false, walls:true, castle:false, plaza:true, harbor:true});
  const {terrain} = buildRiverScene(town);
  const vertices = new Map(town.vertices.map(v => [v.id, v]));
  for (const id of ['v182', 'v183', 'v42']) {
    const p = vertices.get(id);
    const roads = town.roads.filter(r => r.vertexIds[0] === id || r.vertexIds.at(-1) === id);
    assert.equal(roads.length, 2, id);
    const directions = roads.map(({vertexIds}) => {
      const q = vertices.get(vertexIds[0] === id ? vertexIds[1] : vertexIds.at(-2));
      const dx = q.x - p.x, dy = q.y - p.y, length = Math.hypot(dx, dy);
      return [dx / length, dy / length];
    });
    // The outside bisector passes through the former wedge between the two end caps.
    const dx = -directions[0][0] - directions[1][0], dy = -directions[0][1] - directions[1][1];
    const radius = Math.min(...roads.map(r => r.width)) / 2;
    const parts = new Set([...roads.map(r => r.id), 'junction/' + id]);
    const pavement = terrain.spans.filter(span => parts.has(span.id));
    for (const fraction of [.2, .6, .9, .997]) {
      const t = radius * fraction / Math.hypot(dx, dy);
      const probe = local(town, {x:p.x + dx*t, y:p.y + dy*t});
      assert.ok(pavement.some(s => heights(terrain,s.id,probe).some(y => Math.abs(y - .035) < .001)), id + ' at ' + fraction);
    }
  }
});
test('actual bridge has water and an open arch below its deck and both ends meet road height', () => {
  const bridge = sample.river.bridges[0], [a, b] = bridge.points.map(p => local(sample, p));
  const midway = a.map((n, i) => (n + b[i]) / 2);
  const h = heights(scene.town, bridge.id, midway);
  assert.ok(h.length >= 2 && Math.min(...h) > 1.5);
  assert.ok(heights(scene.terrain, 'river', midway).some(z => Math.abs(z + 1.15) < .001));
  assert.deepEqual(heights(scene.terrain, 'land', midway), []);
  for (const end of [a, b]) {
    assert.ok(heights(scene.town, bridge.id, end).some(z => Math.abs(z - .035) < .004));
    const connections = sample.roads.filter(r => r.id !== bridge.roadId && r.vertexIds.some(id => {
      const p = local(sample, sample.vertices.find(v => v.id === id));
      return Math.hypot(end[0] - p[0], end[1] - p[1]) < .0001;
    }));
    assert.ok(connections.some(r => heights(scene.terrain, r.id, end).some(z => Math.abs(z - .035) < .002)));
  }
});
test('all six planned river-town openings have a fitted, passable gatehouse and hardware', () => {
  const result = generateTown({ seed: 7, size: 12, river: true, coast: false, walls: true, castle: false, plaza: true });
  assert.ok(result.ok);
  const town = result.town, rendered = buildRiverScene(town);
  assert.equal(town.gates.length, 6);
  assert.deepEqual(Object.keys(rendered.gates).sort(), town.gates.map(g => g.id).sort());
  assert.ok(rendered.focus.gate);
  const trims = new Set();
  for (const gate of town.gates) {
    const p = local(town, town.vertices.find(v => v.id === gate.vertexId));
    const entry = heights(rendered.town, gate.id, p);
    assert.ok(entry.length >= 2 && Math.min(...entry) > 4.4, 'an arch must exist above the road');
    const parts = rendered.mounts.filter(m => m.source === gate.id);
    const trim = parts.find(m => m.kit.startsWith('gate_arch_trim_'));
    const hardware = parts.filter(m => m.kit === 'gate_hardware_01');
    assert.equal(hardware.length, 1);
    assert.equal(trim.detail, 0);
    assert.equal(hardware[0].detail, 0);
    assert.ok(Math.abs(trim.scale[0] * 4 - 9.6) < .0001, 'arch fits this planned opening');
    assert.deepEqual(hardware[0].scale, trim.scale);
    trims.add(trim.kit);
    for (const part of rendered.town.spans.filter(s => s.id === gate.wallId || s.id.startsWith(gate.wallId + '/'))) {
      assert.ok(heights(rendered.town, part.id, p).every(z => z >= 4.39), gate.id);
    }
  }
  assert.deepEqual([...trims].sort(), ['gate_arch_trim_01', 'gate_arch_trim_02']);
});

test('legacy solid-wall gates open through the masonry, unrelated wall gaps stay empty', () => {
  const town = deserializeTown(serializeTown(sample));
  // A pre-cut opening spanning the ring seam and an older explicit gate on solid wall.
  const coordinates = [[0,20],[0,16],[0,0],[20,0],[40,0],[40,40],[0,40],[0,24]];
  const boundary = coordinates.map(([x,y],i) => {
    const id = 'legacy-wall-v' + i;
    town.vertices.push({id, x:town.center.x+x, y:town.center.y+y});
    return id;
  });
  const gates = [0,3].map(i => ({id:'legacy-gate-'+i, wallId:'legacy-wall', vertexId:boundary[i]}));
  town.walls = [{id:'legacy-wall',kind:'castle',boundary,activeSegments:[false,true,true,true,true,false,true,false],
    towerVertexIds:[],gateIds:gates.map(g=>g.id)}];
  town.gates = gates;
  const rendered = buildRiverScene(town);
  assert.deepEqual(Object.keys(rendered.gates).sort(), gates.map(g=>g.id));
  for (const i of [0,3]) {
    const p = [coordinates[i][0]/2, -coordinates[i][1]/2];
    assert.deepEqual(heights(rendered.town,'legacy-wall',p), []);
    assert.ok(Math.min(...heights(rendered.town,'legacy-gate-'+i,p)) > 4.4);
  }
  assert.equal(rendered.mounts.filter(m=>m.kit==='gate_hardware_01').length, 2);
  assert.deepEqual(heights(rendered.town,'legacy-wall',[10,-20]), []);
  for (const gate of gates) assert.deepEqual(heights(rendered.town,gate.id,[10,-20]), []);
});

test('close views and facade components derive from the saved footprints', () => {
  assert.deepEqual(Object.keys(scene.buildings).sort(),sample.buildings.map(b=>b.id).sort());
  const houseIds=new Set(sample.buildings.map(b=>b.id));
  const kits=new Set(scene.mounts.filter(p=>houseIds.has(p.source)).map(p=>p.kit));
  for(const part of ['opening_01','opening_02','cathedral_belfry_01','cathedral_openings_01__lancet_window']) assert.ok(kits.has(part),part);
  for(const family of ['sign_','dormer_','timber_panel_']) assert.ok([...kits].some(k=>k.startsWith(family)),family);
  assert.ok(scene.focus.street && scene.focus.church && scene.focus.market);
  assert.ok(!scene.focus.castle && !scene.focus.harbor);
  assert.ok(!scene.focus.gate && Object.keys(scene.gates).length === 0);
  assert.ok(scene.mounts.every(p=>[...p.position,...p.scale,p.yaw].every(Number.isFinite) && p.scale.every(x=>x>0)));
  assert.deepEqual(scene.mounts,buildRiverScene(sample).mounts);
  assert.equal(scene.town.patterns.length,scene.town.positions.length/3);
  assert.ok(scene.town.patterns.includes(1) && scene.town.patterns.includes(2));
});

for(const name of ['river-port','estuary']) test(name+' preserves planned docks and cuts water out of moored hulls',()=>{
  const town=deserializeTown(readFileSync(new URL('../../apps/playground/src/river-pilot/assets/'+name+'.json',import.meta.url),'utf8'));
  const rendered=buildRiverScene(town);
  assert.ok(rendered.focus.harbor);
  if(name==='river-port') {
    assert.ok(rendered.focus.castle);
    assert.deepEqual(Object.keys(rendered.gates).sort(), town.gates.map(g=>g.id).sort());
    assert.ok(rendered.mounts.some(m=>m.kit==='castle_keep_turret_01'));
  }
  for(const dock of town.terrain.docks) {
    assert.ok(rendered.town.spans.find(s=>s.id===dock.id)?.count>0);
    const boat=rendered.mounts.find(m=>m.source===dock.id && /cargo|boat|ship/.test(m.kit));
    assert.ok(boat,dock.id);
    const [x,y,z]=boat.position;
    assert.equal(y,-1.15);
    const water=dock.waterbody==='river'?'river':'sea';
    assert.deepEqual(heights(rendered.terrain,water,[x,z]),[]);
    assert.deepEqual(heights(rendered.terrain,'land',[x,z]),[]);
    assert.ok(heights(rendered.terrain,'riverbed',[x,z]).length);
    if(dock.riverHarbor){
      assert.deepEqual([x,z],local(town,dock.riverHarbor.berth.center));
      assert.equal(boat.yaw,dock.riverHarbor.berth.heading);
    }
  }
});

test('dry plans and coast-only plans in every direction keep their source buildings',()=>{
  for(const coast of [false,'north','east','south','west']){
    const result=generateTown({seed:7,size:6,river:false,coast,harbor:!!coast,plaza:true});
    assert.ok(result.ok,String(coast));
    const rendered=buildRiverScene(result.town);
    assert.equal(Object.keys(rendered.buildings).length,result.town.buildings.length);
    assert.ok(!rendered.terrain.spans.some(s=>s.id==='river'));
    assert.equal(rendered.terrain.spans.some(s=>s.id==='sea'),!!coast);
  }
});
