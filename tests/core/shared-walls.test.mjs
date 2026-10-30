import test from 'node:test';
import assert from 'node:assert/strict';
import { connectCastleToCityWall, MIN_CASTLE_CITY_WALL_GAP } from '../../packages/core/dist/shared-walls.js';
import { generateTown, validateTown, serializeTown, deserializeTown } from '../../packages/core/dist/index.js';

function fixture(gap=3) {
  const coords=[[0,0],[100,0],[100,100],[0,100],[20,70],[35,70],[50,70],[50,100-gap],[20,100-gap]];
  const vertices=coords.map(([x,y],i)=>({id:`v${i}`,x,y}));
  return {vertices,walls:[
    {id:'city',kind:'city',boundary:['v0','v1','v2','v3'],activeSegments:[true,true,true,true],gateIds:[],towerVertexIds:['v0','v1','v2','v3']},
    {id:'castle',kind:'castle',boundary:['v4','v5','v6','v7','v8'],activeSegments:[true,true,true,true,true],gateIds:['g0'],towerVertexIds:['v4','v6','v7','v8']}
  ],gates:[{id:'g0',wallId:'castle',vertexId:'v5'}],entrances:['v5'],roads:[{id:'r0',kind:'street',vertexIds:['v0','v5'],width:2}],
  buildings:[{id:'b0',districtId:'d0',boundary:['v4','v6','v7','v8']}],districts:[{id:'d0',wardType:'Castle',boundary:['v4','v6','v7','v8']}],features:[]};
}
const key=(a,b)=>[a,b].sort().join('/');
function minimumDistance(town) {
  const index=new Map(town.vertices.map(v=>[v.id,v]));
  const segments=w=>w.boundary.map((id,i)=>[index.get(id),index.get(w.boundary[(i+1)%w.boundary.length])]).filter((_,i)=>w.activeSegments[i]);
  const dist=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
  const [city,castle]=['city','castle'].map(kind=>segments(town.walls.find(w=>w.kind===kind)));
  return Math.min(...castle.flatMap(([a,b])=>city.map(([c,d])=>Math.min(dist(a,c,d),dist(b,c,d),dist(c,a,b),dist(d,a,b)))));
}
function inspect(town) {
  const city=town.walls.find(w=>w.kind==='city'),castle=town.walls.find(w=>w.kind==='castle');
  const spans=w=>w.boundary.map((a,i)=>({key:key(a,w.boundary[(i+1)%w.boundary.length]),a,b:w.boundary[(i+1)%w.boundary.length],active:w.activeSegments[i]}));
  const outer=new Map(spans(city).map(s=>[s.key,s]));
  return {city,castle,shared:spans(castle).filter(s=>outer.has(s.key)),outer};
}

test('nearby sides connect with one physical wall and unchanged buildings, roads and gate',()=>{
  const town=fixture(),before=JSON.stringify([town.buildings,town.districts,town.roads,town.gates]);
  connectCastleToCityWall(town);
  const {city,castle,shared,outer}=inspect(town);
  assert.ok(shared.length>0);assert.ok(shared.every(s=>!s.active&&outer.get(s.key).active));
  assert.equal(JSON.stringify([town.buildings,town.districts,town.roads,town.gates]),before);
  assert.ok(castle.boundary.includes('v5'));
  assert.ok(castle.towerVertexIds.every(id=>!city.towerVertexIds.includes(id)));
  const vertices=new Map(town.vertices.map(v=>[v.id,v]));
  for(const a of city.towerVertexIds)for(const b of castle.towerVertexIds){const p=vertices.get(a),q=vertices.get(b);assert.ok(Math.hypot(p.x-q.x,p.y-q.y)>=MIN_CASTLE_CITY_WALL_GAP-1e-7);}
  const attached=JSON.stringify(town);connectCastleToCityWall(town);assert.equal(JSON.stringify(town),attached);
});

for(const gap of [MIN_CASTLE_CITY_WALL_GAP,MIN_CASTLE_CITY_WALL_GAP+.01,20])test(`independent walls remain unchanged at an approved gap of ${gap}`,()=>{
  const town=fixture(gap),before=JSON.stringify(town);connectCastleToCityWall(town);assert.equal(JSON.stringify(town),before);
});
test('a gap just below the threshold attaches',()=>{
  const town=fixture(MIN_CASTLE_CITY_WALL_GAP-.0001);connectCastleToCityWall(town);assert.ok(inspect(town).shared.length>0);
});
test('a city gate on the shared stretch keeps its opening and reference',()=>{
  const town=fixture();
  town.vertices.push(...[[40,100],[35,100],[30,100]].map(([x,y],i)=>({id:`top${i}`,x,y})));
  const wall=town.walls[0];wall.boundary=['v0','v1','v2','top0','top1','top2','v3'];wall.activeSegments=[true,true,true,false,false,true,true];wall.gateIds=['g1'];
  town.gates.push({id:'g1',wallId:'city',vertexId:'top1'});town.entrances.push('top1');
  connectCastleToCityWall(town);
  const {city,shared,outer}=inspect(town);assert.ok(city.boundary.includes('top1'));assert.ok(shared.length>=4);
  assert.ok(shared.every(s=>!s.active));assert.equal([...outer.values()].filter(s=>!s.active).length,2);
  assert.deepEqual(city.gateIds,['g1']);
});
test('unsafe attachment across water or a newly intersected building is rejected',()=>{
  const wet=fixture(),cut=[{x:19,y:98},{x:21,y:98},{x:21,y:99},{x:19,y:99}];
  assert.throws(()=>connectCastleToCityWall(wet,[cut]),/crosses water/);
  const blocked=fixture();
  blocked.vertices.push(...[[18.9,98],[19.7,98],[19.7,99],[18.9,99]].map(([x,y],i)=>({id:`house${i}`,x,y})));
  blocked.buildings.push({id:'b1',districtId:'d1',boundary:['house0','house1','house2','house3']});blocked.districts.push({id:'d1',wardType:'Ward'});
  assert.throws(()=>connectCastleToCityWall(blocked),/building clearance/);
});
test('castle entrance on a side being removed cannot silently disappear',()=>{
  const town=fixture();town.vertices.push({id:'outergate',x:35,y:97});town.walls[1].boundary.splice(4,0,'outergate');town.walls[1].activeSegments.push(true);
  town.gates[0].vertexId='outergate';assert.throws(()=>connectCastleToCityWall(town),/move its entrance/);
});
test('no city wall or no castle wall requires no attachment',()=>{
  for(const kind of ['city','castle']){const town=fixture();town.walls=town.walls.filter(w=>w.kind===kind);const before=JSON.stringify(town);connectCastleToCityWall(town);assert.equal(JSON.stringify(town),before);}
});

for(const options of [{seed:645382103,size:12},{seed:1,size:12},{seed:7,size:12},{seed:42,size:12},{seed:12345,size:12},{seed:42,size:40},{seed:1,size:6,river:true},{seed:42,size:24,coast:'east',river:true}])test(`generated shared topology is serializable and has no duplicate physical spans: ${JSON.stringify(options)}`,()=>{
  const result=generateTown({...options,castle:true,walls:true,plaza:true});assert.equal(result.ok,true,JSON.stringify(result.error));
  const town=result.town;validateTown(town);assert.deepEqual(deserializeTown(serializeTown(town)),town);
  const {city,castle,shared}=inspect(town);
  assert.equal(city.boundary.length,city.activeSegments.length);assert.equal(castle.boundary.length,castle.activeSegments.length);
  const active=new Set();
  for(const w of town.walls)for(let i=0;i<w.boundary.length;i++)if(w.activeSegments[i]){const span=key(w.boundary[i],w.boundary[(i+1)%w.boundary.length]);assert.ok(!active.has(span),'shared wall must have one owner');active.add(span);}
  assert.ok(shared.every(s=>!s.active));
  assert.ok(city.towerVertexIds.every(id=>!castle.towerVertexIds.includes(id)));
  if(!shared.length)assert.ok(minimumDistance(town)>=MIN_CASTLE_CITY_WALL_GAP*4-1e-5,'independent walls need at least 24 metres');
  if(options.size===12&&!options.river&&!options.coast)assert.ok(shared.length>0);
});
