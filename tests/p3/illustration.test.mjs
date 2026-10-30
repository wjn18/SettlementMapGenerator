import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown, serializeTown } from '@settlement/core';
import { buildMapScene, THEMES, THEME_LABELS, normalizeThemeName, pointInRing, pickScene, paperTexturePixels } from '@settlement/map-scene';
import { createIllustration } from '../../packages/map-scene/dist/illustration.js';

const result=generateTown({seed:12345,size:24,coast:'east',river:true,harbor:true,castle:true,walls:true,plaza:true});assert(result.ok);
const town=result.town;
test('every paper draws the same fine details in its own palette and the retired paper migrates',()=>{
  assert.equal(Object.keys(THEMES).length,12);assert.equal(Object.keys(THEME_LABELS).length,12);
  assert.equal(Object.hasOwn(THEMES,'parchment'),false);assert.equal(Object.hasOwn(THEME_LABELS,'parchment'),false);
  assert.equal(normalizeThemeName('parchment'),'illustrated');
  const original=serializeTown(town),reference=buildMapScene(town,THEMES.illustrated);
  for(const [name,theme] of Object.entries(THEMES)){
    const scene=buildMapScene(town,theme);
    assert.deepEqual(scene.illustration,reference.illustration,name+' lacks fine cartography');
    assert.deepEqual(scene.landmarks,reference.landmarks);assert.deepEqual(scene.hitRegions,reference.hitRegions);
    assert.deepEqual(scene.paperTexture,{seed:town.resolved.seed,color:theme.paper});
    assert.equal(scene.background,theme.paper);assert.equal(serializeTown(town),original);
  }
});
test('illustrated cartography is deterministic and leaves planning, JSON, geometry and hit regions intact',()=>{
  const original=serializeTown(town),plain=buildMapScene(town,THEMES.illustrated,{illustration:false}),scene=buildMapScene(town,THEMES.illustrated);
  assert.deepEqual(buildMapScene(town,THEMES.illustrated),scene);assert.equal(serializeTown(town),original);
  assert.deepEqual(scene.hitRegions,plain.hitRegions);assert.deepEqual(scene.terrain,plain.terrain);assert.deepEqual(scene.river,plain.river);
  assert(scene.commands.length>plain.commands.length+2000);
  for(const kind of ['trees','fields','waves','boats','piers'])assert(scene.illustration[kind]>0,kind+' is drawn');
  for(const command of scene.commands){
    const points=command.kind==='circle'||command.kind==='image'?[command.center]:command.points;
    assert(points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
    if(command.stroke)assert(command.stroke.width>0);
  }
});

test('river and sea ink stays on water; tree canopies and field furrows stay on dry land',()=>{
  const details=createIllustration(town,THEMES.illustrated);
  const wet=p=>pointInRing(town.river.surface,p)||pointInRing(town.terrain.coast.water,p);
  for(const command of details.water)for(const p of command.points)assert(wet(p),'water texture crossed a bank');
  for(const layer of [details.trees,details.fields])for(const command of layer){
    for(const p of command.kind==='circle'?[command.center]:command.points)assert(!wet(p),'land detail placed on water');
  }
});

test('church, keep and market symbols belong to their districts and remain selectable',()=>{
  const scene=buildMapScene(town,THEMES.illustrated),vertices=new Map(town.vertices.map(v=>[v.id,v]));
  assert.deepEqual(new Set(scene.landmarks.map(l=>l.kind)),new Set(['church','castle','market']));
  for(const icon of scene.landmarks){
    const district=town.districts.find(d=>d.id===icon.districtId);
    assert(pointInRing(district.boundary.map(id=>vertices.get(id)),icon.center));
    assert.equal(pickScene(scene,{centerX:icon.center.x,centerY:icon.center.y,zoom:1},100,100,50,50),district.id);
  }
});

test('large illustrated maps keep a bounded vector scene and original river berths',()=>{
  const result=generateTown({seed:7,size:100,river:true,riverHarbor:true,coast:'east',castle:false,walls:false,plaza:true});assert(result.ok);
  const scene=buildMapScene(result.town,THEMES.illustrated),plain=buildMapScene(result.town,THEMES.illustrated,{illustration:false});
  assert(scene.commands.length-plain.commands.length<12000);assert(scene.illustration.trees<=600);
  assert.deepEqual(scene.terrain.docks,result.town.terrain.docks);
});

test('paper grain has reproducible opaque pixels for portable canvas and SVG exports',()=>{
  const texture={seed:12345,color:THEMES.illustrated.paper},pixels=paperTexturePixels(texture);
  assert.deepEqual(paperTexturePixels(texture),pixels);assert.equal(pixels.length,128*128*4);
  assert.notDeepEqual(paperTexturePixels({...texture,seed:7}),pixels);
  const shades=new Set();for(let i=0;i<pixels.length;i+=4){shades.add(pixels[i]);assert.equal(pixels[i+3],255);}
  assert(shades.size>20);assert(shades.size<70);
});
