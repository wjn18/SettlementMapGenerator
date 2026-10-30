import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown } from '@settlement/core';
import { buildMapScene, THEMES, pickScene } from '@settlement/map-scene';

test('planned river vessel is drawn, selectable and independently copied',()=>{
  const result=generateTown({seed:7,size:12,river:true,riverHarbor:true,walls:false,castle:false,plaza:true});assert(result.ok);
  const town=result.town,scene=buildMapScene(town,THEMES.parchment),dock=town.terrain.docks[0];
  assert.equal(pickScene(scene,{centerX:dock.riverHarbor.berth.center.x,centerY:dock.riverHarbor.berth.center.y,zoom:1},100,100,50,50),dock.districtId);
  assert(scene.commands.some(c=>c.kind==='polygon'&&c.points.length===6&&c.points.every(p=>Math.hypot(p.x-dock.riverHarbor.berth.center.x,p.y-dock.riverHarbor.berth.center.y)<dock.riverHarbor.berth.length)));
  const sailing=town.terrain.docks.find(d=>d.riverHarbor?.berth.boat.startsWith('cargo-'));
  assert(sailing);
  const berth=sailing.riverHarbor.berth;
  assert.equal(pickScene(scene,{centerX:berth.center.x,centerY:berth.center.y,zoom:1},100,100,50,50),sailing.districtId);
  assert(scene.commands.some(c=>c.kind==='polygon'&&c.points.length===3&&c.points.every(p=>Math.hypot(p.x-berth.center.x,p.y-berth.center.y)<berth.length*.3)));
  scene.terrain.docks[0].riverHarbor.berth.center.x+=99;
  scene.terrain.docks[0].riverHarbor.navigation.points[1].y+=99;
  assert.notDeepEqual(scene.terrain.docks[0].riverHarbor,town.terrain.docks[0].riverHarbor);
});
