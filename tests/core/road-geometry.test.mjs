import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRoadGeometry, generateTown } from '@settlement/core';

function streetPlan(split=false) {
  const vertices=[['a',-32,0],['b',0,0],['c',0,32]].map(([id,x,y])=>({id,x,y}));
  const road=(id,vertexIds)=>({id,vertexIds,kind:'street',width:4});
  return {vertices,roads:split?[road('west',['a','b']),road('north',['c','b'])]:[road('bend',['a','b','c'])],
    entrances:[],gates:[],walls:[],buildings:[],features:[]};
}

test('a bend has the same tangent-continuous centerline across reversed, separately saved road segments',()=>{
  const single=buildRoadGeometry(streetPlan()).paths.get('bend');
  const {paths}=buildRoadGeometry(streetPlan(true));
  const west=paths.get('west'),north=paths.get('north').slice().reverse();
  assert.deepEqual(west.at(-1),north[0]);
  assert.deepEqual([...west,...north.slice(1)],single);
  assert.ok(single.length>5 && !single.some(p=>p.x===0 && p.y===0));
  for(let i=1;i+1<single.length;i++) {
    const a=single[i-1],p=single[i],b=single[i+1];
    const cosine=((p.x-a.x)*(b.x-p.x)+(p.y-a.y)*(b.y-p.y))/(Math.hypot(p.x-a.x,p.y-a.y)*Math.hypot(b.x-p.x,b.y-p.y));
    assert.ok(cosine>Math.cos(Math.PI/12),'no individual turn exceeds 15 degrees');
  }
});

test('gates, bridge decks and dock landings keep their alignment; a nearby footprint restricts the curve',()=>{
  const t=streetPlan(), raw=t.vertices.map(({x,y})=>({x,y}));
  t.gates=[{vertexId:'b'}];
  assert.deepEqual(buildRoadGeometry(t).paths.get('bend'),raw);
  t.gates=[]; t.river={width:1,centerline:[],bridges:[{roadId:'bend',points:raw}]};
  assert.deepEqual(buildRoadGeometry(t).paths.get('bend'),raw);
  delete t.river; t.terrain={docks:[{roadId:'bend',points:[{x:-5,y:0}]}]};
  assert.deepEqual(buildRoadGeometry(t).paths.get('bend'),raw);
  delete t.terrain;
  const site=[[-15,2.1],[-2.1,2.1],[-2.1,14],[-15,14]].map(([x,y],i)=>({id:'lot'+i,x,y}));
  t.vertices.push(...site); t.buildings=[{boundary:site.map(v=>v.id)}];
  const constrained=buildRoadGeometry(t).paths.get('bend');
  for (const p of constrained) {
    const dx=Math.max(-15-p.x,0,p.x+2.1),dy=Math.max(2.1-p.y,0,p.y-14);
    assert.ok(Math.hypot(dx,dy)>=2-1e-6);
  }
});

test('the workshop river town rounds centerline bends and junction curbs without moving its six gate crossings',()=>{
  const {town}=generateTown({seed:7,size:12,river:true,coast:false,walls:true,castle:false,plaza:true});
  const before=JSON.stringify(town), vertices=new Map(town.vertices.map(p=>[p.id,p]));
  const {paths,junctions,view}=buildRoadGeometry(town);
  assert.ok(view && junctions.some(j=>j.corners.length));
  assert.ok(town.roads.some(r=>r.kind==='external' && paths.get(r.id).length>r.vertexIds.length));
  for(const gate of town.gates) {
    const {x,y}=vertices.get(gate.vertexId);
    for(const road of town.roads.filter(r=>r.vertexIds.includes(gate.vertexId))) {
      assert.ok(paths.get(road.id).some(p=>p.x===x && p.y===y));
    }
  }
  assert.equal(JSON.stringify(town),before);
});
