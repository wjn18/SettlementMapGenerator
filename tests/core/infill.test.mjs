import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown, generateTownSteps, validateTown, serializeTown, deserializeTown, estimatePopulation } from '../../packages/core/dist/index.js';
import { GenerationContext } from '../../packages/core/dist/context.js';
import { SkeletonModel } from '../../packages/core/dist/skeleton.js';
import { buildTerrainTown } from '../../packages/core/dist/terrain.js';
import { partitionLand } from '../../packages/core/dist/terrain-geometry.js';
import { rebuildCityFortifications } from '../../packages/core/dist/fortifications.js';
import { Point, Polygon, containsPolygon } from '../../packages/core/dist/geometry.js';

const polygon = points => new Polygon(points.map(([x,y]) => new Point(x,y)));
const area = rings => rings.reduce((sum, p) => sum + p.square, 0);

test('a street ending at the wall stays closed; actual crossings and shared exits get gates', () => {
  const envelope=polygon([[-20,-20],[20,-20],[20,20],[-20,20]]);
  const points=[...envelope,...polygon([[-30,0],[30,0],[0,15],[20,15],[-30,-10],[-20,-10],[0,-10]])];
  const vertices=points.map((p,i)=>({id:`v${i}`,x:p.x,y:p.y}));
  const town={vertices,roads:[[4,5],[6,7],[8,9],[9,10]].map((ids,i)=>({id:`r${i}`,kind:'street',width:2,vertexIds:ids.map(n=>`v${n}`)})),
    walls:[{id:'w0',kind:'city',boundary:['v0','v1','v2','v3'],activeSegments:[true,true,true,true],gateIds:[],towerVertexIds:[]}],
    gates:[],entrances:[],districts:[],buildings:[],features:[],bounds:{minX:-30,minY:-20,maxX:30,maxY:20}};
  rebuildCityFortifications(town,[],envelope);
  assert.equal(town.gates.length,3);
  assert.ok(town.gates.some(g=>g.vertexId==='v9'),'two roads sharing an exit form a real crossing');
  assert.ok(town.gates.every(g=>g.vertexId!=='v7'),'dead-end street does not punch a hole');
  const wall=town.walls[0],at=wall.boundary.indexOf('v7');assert.ok(at>=0);
  assert.ok(wall.activeSegments[at]&&wall.activeSegments[(at+wall.boundary.length-1)%wall.boundary.length]);
});

test('wall clipping conserves concave land, including separated pieces and boundary contact', () => {
  const land = polygon([[0,0],[30,0],[30,30],[20,30],[20,10],[10,10],[10,30],[0,30]]);
  const boundary = polygon([[-5,15],[35,15],[35,35],[-5,35]]);
  const saved = JSON.stringify(land), {inside, outside} = partitionLand(land,boundary);
  assert.equal(inside.length,2); assert.ok(Math.abs(area(inside)-300)<1e-6);
  assert.ok(Math.abs(area(inside)+area(outside)-land.square)<1e-6);
  assert.ok(inside.every(p=>containsPolygon(boundary,p)));
  assert.equal(JSON.stringify(land),saved);
  for(const limit of [polygon([[0,0],[30,0],[30,30],[0,30]]), polygon([[30,0],[40,0],[40,30],[30,30]])]) {
    const parts=partitionLand(polygon([[0,0],[30,0],[30,30],[0,30]]),limit);
    assert.ok(Math.abs(area(parts.inside)+area(parts.outside)-900)<1e-6);
  }
});

test('reported city plans all enclosed land before streets and buildings without changing its wall later', () => {
  const options={seed:915481944,size:100,coast:'auto',river:true,harbor:true,castle:false,plaza:true,walls:true,maxAttempts:40};
  const model=new SkeletonModel(new GenerationContext(options.seed,12_500_000,312_500),100,{castle:false,plaza:true,walls:true});
  const iterator=buildTerrainTown(model,options,1);
  let before, wall, generatedCount, result; const stages=[];
  for(;;) {
    const step=iterator.next(); if(step.done){result=step.value;break;}
    stages.push(step.value);
    if(step.value==='buildWalls') before=area(model.patches.map(p=>p.shape));
    if(step.value==='planWalledInfill') {
      wall=JSON.stringify(model.cityEnvelope);
      assert.equal(model.streets.length,0);
      assert.ok(model.patches.every(p=>!p.ward?.geometry.length));
      assert.ok(Math.abs(area(model.patches.map(p=>p.shape))-before)<1e-4,'land area is conserved');
      assert.ok(model.patches.some(p=>p.infill==='housing'));
      assert.ok(model.patches.some(p=>p.infill==='green'));
      for(const p of model.patches.filter(p=>!p.withinCity)) assert.ok(area(partitionLand(p.shape,model.cityEnvelope).inside)<1e-4,'no rural land left inside the wall');
    }
    if(step.value==='createWards') {
      for(const p of model.patches.filter(p=>p.infill==='housing')) assert.ok(p.shape.some((a,i)=>model.streetWidth(a,p.shape[(i+1)%p.shape.length])>0),'new housing has a street frontage');
      for(const p of model.patches.filter(p=>p.infill==='green')) assert.equal(p.ward.type,'Park');
    }
    if(step.value==='buildGeometry') generatedCount=model.patches.reduce((sum,p)=>sum+(p.ward?.geometry.length??0),0);
  }
  assert.ok(stages.indexOf('planWalledInfill')<stages.indexOf('buildStreets'));
  assert.ok(stages.indexOf('buildStreets')<stages.indexOf('buildGeometry'));
  assert.equal(JSON.stringify(model.cityEnvelope),wall,'infill must not expand the wall again');
  assert.equal(result.buildings.length+result.features.length,generatedCount,'export must not delete buildings to fit a late wall');
  validateTown(result);
});

for(const options of [
  {seed:915481944,size:100,coast:'auto',river:true},
  {seed:1077264090,size:100,coast:'auto',river:true,castle:true},
  {seed:42,size:100,castle:true},
  {seed:12345,size:60,river:true},
  {seed:42,size:24,coast:'west',river:true},
  {seed:1,size:12},
]) test(`infill is dry, urban, connected and preserved by export: ${JSON.stringify(options)}`, () => {
  const request={...options,walls:true}; const result=generateTown(request);
  assert.equal(result.ok,true,JSON.stringify(result.error)); const town=result.town;
  validateTown(town); assert.deepEqual(deserializeTown(serializeTown(town)),town);
  const vertices=new Map(town.vertices.map(v=>[v.id,new Point(v.x,v.y)]));
  const shape=ids=>new Polygon(ids.map(id=>vertices.get(id)));
  const wall=shape(town.walls.find(w=>w.kind==='city').boundary);
  // Collapse the collinear tower/gate vertices into the small convex support ring.
  const corners=new Polygon(wall.filter((p,i)=>{
    const a=wall[(i+wall.length-1)%wall.length],b=wall[(i+1)%wall.length];
    return Math.abs((p.x-a.x)*(b.y-p.y)-(p.y-a.y)*(b.x-p.x))>1e-5;
  }));
  for(const d of town.districts.filter(d=>!d.withinCity)) assert.ok(area(partitionLand(shape(d.boundary),corners).inside)<0.2,`rural district ${d.id} enclosed`);
  for(const d of town.districts.filter(d=>d.withinWalls)) assert.ok(d.withinCity&&containsPolygon(wall,shape(d.boundary)));
  assert.ok(town.districts.filter(d=>d.withinCity).length>=options.size);
  assert.ok(town.roads.some(r=>r.kind==='external'),'infill keeps exits to the countryside');
  const links=new Map();
  for(const road of town.roads) for(let i=1;i<road.vertexIds.length;i++) {
    const a=road.vertexIds[i-1],b=road.vertexIds[i];
    if(!links.has(a))links.set(a,new Set()); if(!links.has(b))links.set(b,new Set());
    links.get(a).add(b); links.get(b).add(a);
  }
  const visited=new Set(),queue=[town.roads[0].vertexIds[0]];
  while(queue.length){const p=queue.pop();if(visited.has(p))continue;visited.add(p);queue.push(...links.get(p));}
  assert.equal(visited.size,links.size,'all new streets connect to the existing network');
  const population=estimatePopulation(town);
  assert.equal(population.city.residents,Math.round(population.city.urbanAreaM2/100));
  assert.ok(population.districts.filter(d=>d.withinCity).every(d=>d.residents!==null));
});

test('unwalled generation has no wall infill stage and keeps the requested base count', () => {
  const steps=generateTownSteps({seed:42,size:100,walls:false,castle:false});const stages=[];let result;
  for(;;){const next=steps.next();if(next.done){result=next.value;break;}stages.push(next.value.stage);}
  assert.equal(result.ok,true);assert.equal(stages.includes('planWalledInfill'),false);
  assert.equal(result.town.districts.filter(d=>d.withinCity).length,100);
});
