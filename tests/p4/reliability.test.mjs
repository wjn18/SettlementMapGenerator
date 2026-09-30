import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown, validateTown, TownDataError, GENERATOR_VERSION } from '../../packages/core/dist/index.js';
import { Model } from '../../packages/core/dist/model.js';
import { Point, Polygon, containsPolygon } from '../../packages/core/dist/geometry.js';
import { pointInRing } from '../../packages/map-scene/dist/index.js';
import { installLegacyPaths } from '../core/legacy-path.mjs';

test('road-first generation is independent of the archived patch routing harness', () => {
  const current=generateTown({seed:42,size:24});
  const restore=installLegacyPaths();let archived;
  try {archived=generateTown({seed:42,size:24});} finally {restore();}
  assert(current.ok&&archived.ok);assert.deepEqual(current.town.roads,archived.town.roads);
  assert.deepEqual(generateTown({seed:42,size:24}),current);
});

test('former farm overflow sites generate contained geometry with bounded attempts', () => {
  for (const options of [{seed:708675149,size:6},{seed:2147483646,size:6,plaza:true,castle:false,walls:true}]) {
    const result=generateTown(options);assert.equal(result.ok,true);assert(result.town.resolved.attempts<=20);
    assert.equal(result.town.generatorVersion,GENERATOR_VERSION);assert.equal(GENERATOR_VERSION,'0.10.0');
    const vertices=new Map(result.town.vertices.map(v=>[v.id,v]));
    for(const b of result.town.buildings) {
      const district=result.town.districts.find(d=>d.id===b.districtId);
      assert(b.boundary.every(id=>pointInRing(district.boundary.map(id=>vertices.get(id)),vertices.get(id))));
    }
  }
});
test('containment rejects edges crossing concave notches, but accepts boundary contact', () => {
  const outer=new Polygon([[0,0],[6,0],[6,6],[4,6],[4,2],[2,2],[2,6],[0,6]].map(([x,y])=>new Point(x,y)));
  const crossing=new Polygon([[1,1],[5,1],[5,5],[1,5]].map(([x,y])=>new Point(x,y)));
  assert.equal(containsPolygon(outer,crossing),false);
  assert.equal(containsPolygon(outer,new Polygon([[0,0],[6,0],[6,1],[0,1]].map(([x,y])=>new Point(x,y)))),true);
});
test('degenerate and nonfinite generated geometry stops at the retry budget', () => {
  const original=Model.prototype.buildGeometry;
  try {
    for(const bad of [new Polygon([new Point(0,0),new Point(0,0),new Point(0,0)]),new Polygon([new Point(NaN,0),new Point(1,0),new Point(0,1)])]) {
      Model.prototype.buildGeometry=function(){original.call(this);this.patches[0].ward.geometry=[bad];};
      const result=generateTown({seed:42,size:6,maxAttempts:2});assert.equal(result.ok,false);
      assert.equal(result.error.code,'GENERATION_FAILED');assert.equal(result.error.attempts,2);assert.equal(result.error.stage,'export');
    }
  } finally {Model.prototype.buildGeometry=original;}
});
test('nonfinite, collinear and reversed imported polygons give TownDataError', () => {
  const result=generateTown({seed:42,size:6});assert(result.ok);
  for(const mutation of [
    t=>{for(const id of t.buildings[0].boundary)t.vertices.find(v=>v.id===id).y=0;},
    t=>{t.buildings[0].boundary.reverse();},
    t=>{t.vertices[0].x=Number.MAX_VALUE;t.vertices[1].y=Number.MAX_VALUE;},
  ]) {const town=structuredClone(result.town);mutation(town);assert.throws(()=>validateTown(town),TownDataError);}
});
