import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown, serializeTown, deserializeTown, validateTown } from '@settlement/core';
import { riverHarborErrors } from '../../packages/core/dist/river-harbor.js';

function generate(options) {
  const result=generateTown({seed:7,size:12,river:true,riverHarbor:true,walls:false,castle:false,plaza:true,...options});
  assert.equal(result.ok,true,JSON.stringify(result));return result.town;
}
for(const size of [6,12,24,40,100])test(`river harbor ${size}: geometry, navigation, scale and JSON`,()=>{
  const town=generate({size});validateTown(town);
  assert.deepEqual(riverHarborErrors(town),[]);
  const docks=town.terrain.docks.filter(d=>d.waterbody==='river');assert(docks.length>=2&&docks.length<=4);
  assert(docks.some(d=>d.riverHarbor.berth.boat==='cargo'));
  assert(docks.some(d=>d.riverHarbor.berth.boat.startsWith('cargo-')));
  for(const d of docks){assert(d.riverHarbor.navigation.width>=d.riverHarbor.berth.beam);assert(town.districts.some(q=>q.id===d.districtId&&q.wardType==='Harbor'));}
  assert.deepEqual(deserializeTown(serializeTown(town)),town);
});
for(const coast of ['east','south','west','north'])test(`river harbor and sea harbor coexist / ${coast}`,()=>{
  const town=generate({size:24,coast,harbor:true});validateTown(town);
  assert(town.terrain.docks.some(d=>d.waterbody==='river'));
  assert(town.terrain.docks.some(d=>!d.waterbody||d.waterbody==='coast'));
});
test('independent switches, old snapshots and deterministic plans',()=>{
  const options={seed:42,size:12,coast:'east',harbor:false};
  const town=generate(options);assert(town.terrain.docks.every(d=>d.waterbody==='river'));
  assert.equal(serializeTown(town),serializeTown(generate(options)));
  const old=generate({riverHarbor:false});assert.equal(old.terrain.docks.length,0);delete old.request.riverHarbor;
  assert.deepEqual(deserializeTown(serializeTown(old)),old);
  assert.equal(generateTown({seed:7,size:12,riverHarbor:true}).ok,false);
  assert.equal(generateTown({seed:7,size:12,river:true,riverHarbor:'true'}).ok,false);
});
test('walls, castle and yard retain safe access',()=>{
  const town=generate({seed:42,size:24,walls:true,castle:true});validateTown(town);
});

test('small walled town mixes restored-size cargo boats and sailing cargo vessels',()=>{
  const town=generate({seed:1246393668,size:6,walls:true,castle:true,maxAttempts:20});
  validateTown(town);
  assert(town.river.width>=72);
  for(const dock of town.terrain.docks.filter(d=>d.waterbody==='river')){
    assert(dock.width>=5.4);
    if(dock.riverHarbor.berth.boat==='cargo'){
      assert(dock.riverHarbor.berth.length<=28.8);
      assert(dock.riverHarbor.berth.beam<=9.2);
    }
  }
  assert(town.terrain.docks.some(d=>d.riverHarbor?.berth.boat==='cargo' && d.riverHarbor.berth.length===28.8 && d.riverHarbor.berth.beam===9.2));
  assert(town.terrain.docks.some(d=>d.riverHarbor?.berth.boat.startsWith('cargo-')));
});

test('current small town keeps both boat classes after deterministic JSON round-trip',()=>{
  const town=generate({seed:1983253114,size:12,walls:true,castle:true,maxAttempts:20});
  assert(town.terrain.docks.some(d=>d.riverHarbor?.berth.boat==='cargo'));
  assert(town.terrain.docks.some(d=>d.riverHarbor?.berth.boat.startsWith('cargo-')));
  assert.deepEqual(deserializeTown(serializeTown(town)),town);
});
test('reject detached, flooded, blocked and malformed imported river harbors',()=>{
  const original=generate({size:24});
  for(const mutate of [
    t=>{delete t.terrain.docks[0].riverHarbor;},
    t=>{t.request.riverHarbor=false;},
    t=>{t.terrain.docks[0].riverHarbor.berth.center={...t.river.centerline[45]};},
    t=>{t.terrain.docks[0].riverHarbor.navigation.width=.01;},
    t=>{t.terrain.docks[0].points[0].x+=10;},
    t=>{t.terrain.docks[0].riverHarbor.berth.boat='ocean-ship';},
    t=>{t.terrain.docks[0].riverHarbor.berth.heading=NaN;},
    t=>{t.terrain.docks=[];},
    t=>{t.terrain.docks[0].riverHarbor.navigation.points=t.river.bridges[0].points;},
  ]) {const changed=structuredClone(original);mutate(changed);assert.throws(()=>validateTown(changed));}
});
