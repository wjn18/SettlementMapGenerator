import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileHash } from '../../apps/playground/server/three-d-cache.mjs';
import { recoveryAssets } from '../../apps/playground/server/three-d-assets.mjs';

async function fixture() {
  const root=path.resolve('artifacts/recovery-assets-tests',randomUUID()),dir=path.join(root,'saved');
  await fs.mkdir(dir,{recursive:true});
  const files={base:'artifacts/small-town-assets/small-town-asset-library.blend',harbor:'artifacts/harbor-assets/harbor-asset-library.blend',metadata:'artifacts/harbor-assets/asset-library.json'};
  for(const [key,file] of Object.entries(files)){files[key]=path.join(root,file);await fs.mkdir(path.dirname(files[key]),{recursive:true});await fs.writeFile(files[key],key+' bytes');}
  const manifest={roadSurfaces:{version:4},assetIntegration:{enabled:true,librarySha256:await fileHash(files.base),additionalLibraries:[{kitId:'harbor_kit',sha256:await fileHash(files.harbor),manifestSha256:await fileHash(files.metadata)}]},harbor:{enabled:true,quayOpenings:[],waterExclusion:[{object:'Harbor_sea_surface'}]}};
  const save=()=>fs.writeFile(path.join(dir,'scene-manifest.json'),JSON.stringify(manifest));await save();
  return {root,dir,files,manifest,save,town:{terrain:{coast:{side:'east'}},buildings:[],districts:[]}};
}
test('unchanged current materials permit the existing saved-scene recovery',async()=>{
  const f=await fixture();assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,true);
});
for(const key of ['base','harbor','metadata'])test(`updated ${key} assets rebuild the original plan with current materials`,async()=>{
  const f=await fixture();await fs.appendFile(f.files[key],' update');assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
});
test('a saved harbor without the new hull metadata cannot reuse old ships',async()=>{
  const f=await fixture();delete f.manifest.assetIntegration.additionalLibraries[0].manifestSha256;await f.save();
  assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
});
test('pre-water-exclusion scenes rebuild even when their library bytes match',async()=>{
  const f=await fixture();delete f.manifest.harbor.waterExclusion;await f.save();
  assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
});
test('legacy procedural scenes upgrade to authored assets on default retry',async()=>{
  const f=await fixture();f.manifest.assetIntegration.enabled=false;await f.save();
  assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
});

async function riverFixture() {
  const root=path.resolve('artifacts/recovery-assets-tests',randomUUID()),dir=path.join(root,'saved');
  await fs.mkdir(dir,{recursive:true});
  const files={base:'artifacts/small-town-assets/small-town-asset-library.blend',river:'artifacts/river-assets/river-asset-library.blend',metadata:'artifacts/river-assets/asset-library.json'};
  for(const [key,file] of Object.entries(files)){files[key]=path.join(root,file);await fs.mkdir(path.dirname(files[key]),{recursive:true});await fs.writeFile(files[key],key+' bytes');}
  const manifest={roadSurfaces:{version:4},assetIntegration:{enabled:true,librarySha256:await fileHash(files.base),additionalLibraries:[{kitId:'river_kit',sha256:await fileHash(files.river),manifestSha256:await fileHash(files.metadata)}]},river:{enabled:true,version:2}};
  const save=()=>fs.writeFile(path.join(dir,'scene-manifest.json'),JSON.stringify(manifest));await save();
  return {root,dir,files,manifest,save,town:{river:{surface:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]},buildings:[],districts:[]}};
}

test('current inland river scenes recover with identical bridge and bank kit bytes',async()=>{
  const f=await riverFixture(),decision=await recoveryAssets(f.dir,f.root,f.town);
  assert.equal(decision.reuse,true);
  // This fixture deliberately contains no harbor library: inland river
  // recovery must not require or invent an unrelated coastal kit.
  await assert.rejects(fs.access(path.join(f.root,'artifacts/harbor-assets/harbor-asset-library.blend')));
});

for(const key of ['river','metadata'])test(`updated ${key} river resources rebuild the original planning snapshot`,async()=>{
  const f=await riverFixture();await fs.appendFile(f.files[key],' changed');
  const decision=await recoveryAssets(f.dir,f.root,f.town);
  assert.equal(decision.reuse,false);assert.match(decision.reason,key==='river'?/river_kit library/:/river kit geometry or assembly metadata/);
});

for(const state of ['missing','disabled','older','future'])test(`${state} river assembly versions cannot reuse a source-only saved scene`,async()=>{
  const f=await riverFixture();
  if(state==='missing')delete f.manifest.river;
  else if(state==='disabled')f.manifest.river.enabled=false;
  else f.manifest.river.version=state==='older'?1:3;
  await f.save();const decision=await recoveryAssets(f.dir,f.root,f.town);
  assert.equal(decision.reuse,false);assert.match(decision.reason,/predates the raised stone arch bridges/);
});

test('river recovery requires the kit entry and its assembly metadata hash',async()=>{
  for(const remove of ['entry','hash']) {
    const f=await riverFixture();
    if(remove==='entry')f.manifest.assetIntegration.additionalLibraries=[];
    else delete f.manifest.assetIntegration.additionalLibraries[0].manifestSha256;
    await f.save();assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
  }
});

async function estuaryFixture() {
  const fixture=await riverFixture();
  fixture.files.harbor=path.join(fixture.root,'artifacts/harbor-assets/harbor-asset-library.blend');
  fixture.files.harborMetadata=path.join(fixture.root,'artifacts/harbor-assets/asset-library.json');
  await fs.mkdir(path.dirname(fixture.files.harbor),{recursive:true});
  await fs.writeFile(fixture.files.harbor,'harbor kit bytes');await fs.writeFile(fixture.files.harborMetadata,'harbor metadata bytes');
  fixture.manifest.assetIntegration.additionalLibraries.push({kitId:'harbor_kit',sha256:await fileHash(fixture.files.harbor),manifestSha256:await fileHash(fixture.files.harborMetadata)});
  fixture.manifest.harbor={enabled:true,quayOpenings:[],waterExclusion:[{object:'Harbor_sea_surface'},{object:'River_water_surface'}]};
  fixture.manifest.estuary={enabled:true,version:1};fixture.town.terrain={coast:{side:'east'}};
  await fixture.save();return fixture;
}

test('combined river mouths recover only with both current kits and the current water-domain version',async()=>{
  const f=await estuaryFixture();assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,true);
});
test('inland river ports require the harbor kit, current berth version and river water exclusion',async()=>{
  const f=await estuaryFixture();delete f.town.terrain.coast;
  f.town.terrain.docks=[{waterbody:'river'}];f.manifest.harbor.version=2;f.manifest.river.bedLevel=-3.6;await f.save();
  assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,true);
  f.manifest.river.bedLevel=-2;await f.save();
  const shallow=await recoveryAssets(f.dir,f.root,f.town);assert.equal(shallow.reuse,false);assert.match(shallow.reason,/clearance for enlarged cargo/);
  f.manifest.river.bedLevel=-3.6;
  f.manifest.harbor.version=1;await f.save();assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
  f.manifest.harbor.version=2;f.manifest.harbor.waterExclusion=[{object:'Harbor_sea_surface'}];await f.save();
  assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
});

for(const state of ['missing','disabled','older','future'])test(`${state} combined-water versions rebuild estuary scenes from their original plans`,async()=>{
  const f=await estuaryFixture();
  if(state==='missing')delete f.manifest.estuary;
  else if(state==='disabled')f.manifest.estuary.enabled=false;
  else f.manifest.estuary.version=state==='older'?0:2;
  await f.save();const decision=await recoveryAssets(f.dir,f.root,f.town);
  assert.equal(decision.reuse,false);assert.match(decision.reason,/combined river-mouth and coastal geometry/);
});

for(const key of ['river','metadata','harbor','harborMetadata'])test(`updated ${key} resources invalidate a recovered coastal river`,async()=>{
  const f=await estuaryFixture();await fs.appendFile(f.files[key],' changed');
  assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
});

for(const kit of ['river_kit','harbor_kit'])test(`an estuary cannot recover with its ${kit} missing`,async()=>{
  const f=await estuaryFixture();f.manifest.assetIntegration.additionalLibraries=f.manifest.assetIntegration.additionalLibraries.filter(entry=>entry.kitId!==kit);
  await f.save();assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
});

test('saved estuary citizens require the current bridge and water footprint reservations',async()=>{
  const f=await estuaryFixture();f.town.river.bridges=[{id:'bridge0'}];
  const current={people:4,people_reserved_clearance_verified:true,people_footprint_radius_m:.28,reserved_water_count:2,reserved_passage_count:1};
  f.manifest.props={...current};await f.save();assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,true);
  for(const mutate of [stats=>delete stats.people_reserved_clearance_verified,stats=>delete stats.people_footprint_radius_m,
    stats=>stats.people_footprint_radius_m=0,stats=>stats.reserved_water_count=1,stats=>stats.reserved_passage_count=0]) {
    f.manifest.props={...current};mutate(f.manifest.props);await f.save();
    const decision=await recoveryAssets(f.dir,f.root,f.town);assert.equal(decision.reuse,false);assert.match(decision.reason,/reserved river passages and water clearances/);
  }
});

async function shortRoadFixture({scale=.5,segments=[.0018]}={}) {
  const f=await fixture();f.manifest.horizontalScale=scale;
  f.town.vertices=segments.flatMap((length,i)=>[{id:`a${i}`,x:0,y:i},{id:`b${i}`,x:length,y:i}]);
  f.town.roads=segments.map((_,i)=>({id:`r${i}`,width:15.2,vertexIds:[`a${i}`,`b${i}`]}));
  const selection={roads:f.town.roads.map(road=>({...road,sourceId:road.id,
    points:road.vertexIds.map(id=>{const {x,y}=f.town.vertices.find(vertex=>vertex.id===id);return {x,y};})}))};
  await f.save();
  await fs.writeFile(path.join(f.dir,'scene.blend'),'saved road and roof mesh bytes');
  await fs.writeFile(path.join(f.dir,'source-town.json'),JSON.stringify(f.town));
  await fs.writeFile(path.join(f.dir,'selection.json'),JSON.stringify(selection));
  const sourceFilesSha256={};
  for(const file of ['scene.blend','selection.json','source-town.json','scene-manifest.json'])sourceFilesSha256[file]=await fileHash(path.join(f.dir,file));
  // A failed roof is repairable, provided this scene's roads independently pass.
  const report={status:'fail',horizontalScale:scale,sourceFilesSha256,failures:['Roof footprint requires precision repair.'],
    roads:f.town.roads.map(road=>({id:road.id,sourceId:road.id,passed:true,checks:{centerlineCoverage:true,sourceWidthAndCoordinates:true}}))};
  const saveReport=()=>fs.writeFile(path.join(f.dir,'verification.json'),JSON.stringify(report));
  await saveReport();return {...f,report,saveReport};
}

test('verified short roads permit roof-only recovery even if the overall old report failed',async()=>{
  const f=await shortRoadFixture();assert.equal(f.report.status,'fail');
  assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,true);
});

test('ordinary, exactly-threshold and duplicate road points keep recovery without old verification',async()=>{
  const f=await shortRoadFixture({segments:[12,.002,0]});
  await fs.rm(path.join(f.dir,'verification.json'));
  assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,true);
});

test('the short-road threshold uses the saved scene scale rather than a fixed plan-space distance',async()=>{
  const short=await shortRoadFixture({scale:.25,segments:[.003]}),long=await shortRoadFixture({scale:2,segments:[.0008]});
  for(const f of [short,long])await fs.rm(path.join(f.dir,'verification.json'));
  assert.equal((await recoveryAssets(short.dir,short.root,short.town)).reuse,false);
  assert.equal((await recoveryAssets(long.dir,long.root,long.town)).reuse,true);
});

test('the actual old short-road coverage failure rebuilds even when coordinate checks passed',async()=>{
  const f=await shortRoadFixture();f.report.roads[0].passed=false;f.report.roads[0].checks.centerlineCoverage=false;
  f.report.failures=['Road surface verification failed: r0 (centerlineCoverage)'];await f.saveReport();
  const decision=await recoveryAssets(f.dir,f.root,f.town);assert.equal(decision.reuse,false);assert.match(decision.reason,/Short nonzero source road/);
});

for(const check of ['centerlineCoverage','sourceWidthAndCoordinates'])test(`short roads require explicit true ${check} evidence`,async()=>{
  for(const value of [undefined,false,'true']) {
    const f=await shortRoadFixture();f.report.roads[0].checks[check]=value;await f.saveReport();
    assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
  }
});

test('all short source roads need distinct matching source identities',async()=>{
  for(const mutation of [report=>report.roads.pop(),report=>report.roads[1].id='unplanned',
    report=>report.roads[1].sourceId='r0',report=>report.roads.push({...report.roads[0]})]) {
    const f=await shortRoadFixture({segments:[.0018,.0016]});mutation(f.report);await f.saveReport();
    assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
  }
});

for(const file of ['scene.blend','selection.json','source-town.json','scene-manifest.json'])test(`a changed ${file} invalidates otherwise passing short-road evidence`,async()=>{
  const f=await shortRoadFixture();await fs.appendFile(path.join(f.dir,file),' ');
  assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
});

test('short-road evidence must contain every file hash, the manifest scale and road rows',async()=>{
  for(const mutation of [report=>delete report.sourceFilesSha256,
    ...['scene.blend','selection.json','source-town.json','scene-manifest.json'].map(file=>report=>delete report.sourceFilesSha256[file]),
    report=>report.horizontalScale=.25,report=>delete report.roads,report=>report.roads={}]) {
    const f=await shortRoadFixture();mutation(f.report);await f.saveReport();
    assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
  }
});

test('missing, unreadable or incomplete verification rebuilds short roads from the original source',async()=>{
  for(const data of [null,'{invalid json','{}']) {
    const f=await shortRoadFixture();
    if(data===null)await fs.rm(path.join(f.dir,'verification.json'));
    else await fs.writeFile(path.join(f.dir,'verification.json'),data);
    assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
  }
  const f=await shortRoadFixture();await fs.rm(path.join(f.dir,'scene.blend'));
  assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
});
