import test from 'node:test';
import assert from 'node:assert/strict';
import {Point} from '../../packages/core/dist/geometry.js';
import {filletRoad} from '../../packages/core/dist/road-curves.js';
import {selectWallTowerIds} from '../../packages/core/dist/wall-towers.js';

test('wall subdivision nodes do not create a three-tower cluster',()=>{
  const vertices=[[0,0],[100,0],[100,100],[0,100],[0,86],[0,72]].map(([x,y],i)=>({id:'v'+i,x,y}));
  const towerVertexIds=['v4','v5','v3','v0','v1','v2'];
  const town={vertices,walls:[{id:'w',kind:'castle',boundary:vertices.map(v=>v.id),activeSegments:vertices.map(()=>true),towerVertexIds}]};
  const before=JSON.stringify(town),kept=selectWallTowerIds(town).get('w');
  assert.equal(JSON.stringify(town),before);assert(kept.includes('v3'));assert(!kept.includes('v4')&&!kept.includes('v5'));
  for(const a of kept)for(const b of kept)if(a!==b){const p=vertices.find(v=>v.id===a),q=vertices.find(v=>v.id===b);assert(Math.hypot(p.x-q.x,p.y-q.y)>=32);}
});

test('gate approach curves keep endpoints and follow a tangent transition',()=>{
  const path=[[0,0],[20,0],[20,20]].map(([x,y])=>new Point(x,y));
  const curve=filletRoad(path,4,new Set(),[]);assert(curve.length>8);assert.equal(curve[0],path[0]);assert.equal(curve.at(-1),path.at(-1));
  assert.equal(curve[1].y,0);assert.equal(curve.at(-2).x,20);
  const turns=[];
  for(let i=1;i<curve.length-1;i++){
    const a=curve[i-1],p=curve[i],b=curve[i+1];const dot=((p.x-a.x)*(b.x-p.x)+(p.y-a.y)*(b.y-p.y))/Math.hypot(p.x-a.x,p.y-a.y)/Math.hypot(b.x-p.x,b.y-p.y);
    turns.push(Math.acos(Math.max(-1,Math.min(1,dot))));
  }
  assert(Math.max(...turns)<Math.PI/12);
});

test('shared junctions and tight road corners are not moved by smoothing',()=>{
  const path=[[0,0],[20,0],[20,20]].map(([x,y])=>new Point(x,y));
  assert.deepEqual(filletRoad(path,4,new Set([path[1]]),[]),path);
  const tight=[[0,0],[1,0],[1,1]].map(([x,y])=>new Point(x,y));
  assert.deepEqual(filletRoad(tight,4,new Set(),[]),tight);
});

test('a fillet cannot shortcut through a water cut',()=>{
  const path=[[0,0],[20,0],[20,20]].map(([x,y])=>new Point(x,y));
  const water=[[[15,.2],[19.8,.2],[19.8,4],[15,4]].map(([x,y])=>({x,y}))];
  assert.deepEqual(filletRoad(path,4,new Set(),water),path);
});
