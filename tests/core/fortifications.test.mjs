import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown, validateTown, serializeTown, deserializeTown, polygonTouchesRiver } from '../../packages/core/dist/index.js';
import { defensiveEnvelope } from '../../packages/core/dist/fortifications.js';
import { Point, Polygon, containsCoordinate } from '../../packages/core/dist/geometry.js';
import { intersection, inRing } from '../../packages/core/dist/terrain-geometry.js';

const turn = (a,b,c) => (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
test('defensive envelope spans narrow parcel recesses without moving or excluding the core', () => {
  const core = new Polygon([[0,0],[25,0],[25,20],[40,20],[40,0],[70,0],[70,65],[40,65],[40,45],[25,45],[25,65],[0,65]].map(([x,y])=>new Point(x,y)));
  const saved = JSON.stringify(core), envelope = defensiveEnvelope(core);
  assert.equal(JSON.stringify(core), saved);
  assert.ok(core.every(p=>containsCoordinate(envelope,p)));
  assert.ok(envelope.perimeter < core.perimeter * 0.85);
  assert.equal(envelope.length, 4);
});

for (const seed of [1077264090, 42, 12345]) for (const water of [{},{coast:'auto',river:true}])
test(`compact walls, real gate crossings and building clearance ${seed}/${JSON.stringify(water)}`, () => {
  const options = {seed,size:100,castle:true,plaza:true,walls:true,...water};
  const result = generateTown(options); assert.equal(result.ok,true,JSON.stringify(result.error));
  const town=result.town; validateTown(town); assert.deepEqual(deserializeTown(serializeTown(town)),town);
  const vertices=new Map(town.vertices.map(v=>[v.id,v])), wall=town.walls.find(w=>w.kind==='city');
  const ring=wall.boundary.map(id=>vertices.get(id));
  const corners=ring.filter((p,i)=>{
    const a=ring[(i+ring.length-1)%ring.length],b=ring[(i+1)%ring.length];
    return Math.abs(turn(a,p,b))/Math.hypot(p.x-a.x,p.y-a.y)/Math.hypot(b.x-p.x,b.y-p.y)>0.03;
  });
  assert.ok(corners.length<=20,`too many changes of bearing: ${corners.length}`);
  assert.ok(ring.every((p,i)=>turn(ring[(i+ring.length-1)%ring.length],p,ring[(i+1)%ring.length])>=-1e-5));
  assert.ok(wall.gateIds.length>0);
  for(const id of wall.gateIds){
    const gate=town.gates.find(g=>g.id===id),i=wall.boundary.indexOf(gate.vertexId);
    assert.ok(town.roads.some(r=>r.vertexIds.includes(gate.vertexId)), 'gate is a shared road vertex');
    assert.equal(wall.activeSegments[i],false); assert.equal(wall.activeSegments[(i+ring.length-1)%ring.length],false);
  }
  const towers=wall.towerVertexIds.map(id=>vertices.get(id));
  for(let i=0;i<towers.length;i++)for(let j=i+1;j<towers.length;j++)assert.ok(Math.hypot(towers[i].x-towers[j].x,towers[i].y-towers[j].y)>=40-1e-5);
  const waters=[...(town.river?.surface?[town.river.surface]:[]),...(town.terrain?.coast?[town.terrain.coast.water]:[])];
  for(let i=0;i<ring.length;i++)if(wall.activeSegments[i]){
    const a=ring[i],b=ring[(i+1)%ring.length];
    for(const water of waters)assert.equal(inRing(water,{x:(a.x+b.x)/2,y:(a.y+b.y)/2}),false);
    for(const building of town.buildings)assert.equal(polygonTouchesRiver(building.boundary.map(id=>vertices.get(id)),{centerline:[a,b],width:14.4,bankWidth:0}),false,`wall or tower overlaps ${building.id}`);
    for(const road of town.roads)for(let j=1;j<road.vertexIds.length;j++){
      const hit=intersection(a,b,vertices.get(road.vertexIds[j-1]),vertices.get(road.vertexIds[j]));
      assert.ok(!hit||hit[0]<1e-6||hit[0]>1-1e-6||hit[1]<1e-6||hit[1]>1-1e-6,'a solid wall crosses a road without a gate');
    }
  }
  assert.equal(town.buildings.filter(b=>town.districts.find(d=>d.id===b.districtId).wardType==='Castle').length,1);
});
