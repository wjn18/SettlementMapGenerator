import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { serializeTown } from '@settlement/core';
import { inspectCache, writeSignature, fileHash, townHash, fingerprints } from '../../apps/playground/server/three-d-cache.mjs';
import { recoveryAssets } from '../../apps/playground/server/three-d-assets.mjs';
import { addExistingParkMarkets } from './multi-market-fixtures.mjs';

const original=JSON.parse(await fs.readFile('artifacts/3d-river-town/source-town.json','utf8'));
const multi=addExistingParkMarkets(original,['d51']);
const marketIds=multi.districts.filter(d=>d.wardType==='Market').map(d=>d.id).sort();
const fp={version:1,scene:'markets-v1',verification:'per-market-checks-v1',rendering:'image-v1'};

async function cacheFixture(town=multi) {
  const dir=path.resolve('artifacts/multi-market-unit-tests',randomUUID());await fs.mkdir(dir,{recursive:true});
  const files={'source-town.json':serializeTown(town)+'\n','selection.json':'{}','scene-manifest.json':'{}',
    'scene.blend':'immutable actual scene bytes','asset-integration.json':'{"enabled":true}'};
  for(const [name,bytes] of Object.entries(files))await fs.writeFile(path.join(dir,name),bytes);
  await fs.writeFile(path.join(dir,'city-center-render.png'),PNG.sync.write(new PNG({width:2,height:2})));
  const sourceFilesSha256={};for(const file of ['source-town.json','selection.json','scene-manifest.json','scene.blend'])sourceFilesSha256[file]=await fileHash(path.join(dir,file));
  const report={status:'pass',assetIntegration:{passed:true},sourceFilesSha256,
    markets:{enabled:true,version:1,passed:true,plazas:town.districts.filter(d=>d.wardType==='Market').map(d=>({id:d.id,passed:true}))}};
  const criteria={sourceHash:townHash(town),fingerprint:fp,quality:'high',view:'center',resolution:2};
  const save=async()=>{await fs.writeFile(path.join(dir,'verification.json'),JSON.stringify(report));await writeSignature(dir,{sourceHash:criteria.sourceHash,fingerprint:fp,quality:'high'});};
  await save();return {dir,criteria,report,save};
}

test('controlled two-market plan preserves every coordinate, source ID and unrelated entity',()=>{
  assert.deepEqual({...multi,districts:original.districts},original);
  assert.deepEqual(marketIds,['d51','d9']);
  assert.throws(()=>addExistingParkMarkets(original,['d13']),/planned feature/);
  assert.throws(()=>addExistingParkMarkets(original,['d9']),/existing empty/);
});

test('all source markets must have independently passed rows before a result can be reused',async()=>{
  const f=await cacheFixture();assert.equal((await inspectCache(f.dir,f.criteria))?.result,true);
  f.report.markets.plazas.reverse();await f.save();assert.equal((await inspectCache(f.dir,f.criteria))?.result,true);
});

for(const [name,mutate] of [
  ['missing market report',r=>delete r.markets],
  ['failed market report',r=>r.markets.passed=false],
  ['disabled market report',r=>r.markets.enabled=false],
  ['missing current report version',r=>delete r.markets.version],
  ['missing second market',r=>r.markets.plazas.pop()],
  ['duplicate market IDs',r=>r.markets.plazas[1].id=r.markets.plazas[0].id],
  ['unplanned market ID',r=>r.markets.plazas[0].id='ghost'],
  ['failed per-market row',r=>r.markets.plazas[1].passed=false],
])test(`signed caches reject ${name} even if the overall status says pass`,async()=>{
  const f=await cacheFixture();mutate(f.report);await f.save();assert.equal(await inspectCache(f.dir,f.criteria),null);
});

test('legacy single-market caches remain readable without the new plural market report',async()=>{
  const f=await cacheFixture(original);delete f.report.markets;await f.save();assert.equal((await inspectCache(f.dir,f.criteria))?.result,true);
});

async function recoveryFixture(ids=['m0','m1']) {
  const root=path.resolve('artifacts/multi-market-recovery-tests',randomUUID()),dir=path.join(root,'saved');await fs.mkdir(dir,{recursive:true});
  const file=path.join(root,'artifacts/small-town-assets/small-town-asset-library.blend');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'same current authored library');
  const town={districts:ids.map(id=>({id,wardType:'Market'})),buildings:[]};
  const manifest={roadSurfaces:{version:4},assetIntegration:{enabled:true,librarySha256:await fileHash(file),additionalLibraries:[]},
    markets:{enabled:true,version:1,plazas:ids.map(id=>({id,groundObject:'Original_market_square_'+id,props:{},objects:[]}))}};
  const save=()=>fs.writeFile(path.join(dir,'scene-manifest.json'),JSON.stringify(manifest));await save();
  return {root,dir,town,manifest,save};
}

test('current per-market scene identity permits saved-scene recovery',async()=>{
  const f=await recoveryFixture();assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,true);
});

test('market structures require recorded actual footprints before occupied layouts can be recovered',async()=>{
  const f=await recoveryFixture();f.manifest.markets.propsEnabled=true;
  for(const row of f.manifest.markets.plazas)row.props={people:84,stalls:8,reserved_structure_count:12,people_structure_clearance_verified:true};
  await f.save();assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,true);
  delete f.manifest.markets.plazas[1].props.reserved_structure_count;await f.save();assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
});

for(const [name,mutate] of [
  ['missing structure clearance result',p=>delete p.people_structure_clearance_verified],
  ['failed structure clearance result',p=>p.people_structure_clearance_verified=false],
  ['negative structure count',p=>p.reserved_structure_count=-1],
  ['fractional structure count',p=>p.reserved_structure_count=.5],
])test(`recovery rebuilds an occupied market with ${name}`,async()=>{
  const f=await recoveryFixture();f.manifest.markets.propsEnabled=true;
  for(const row of f.manifest.markets.plazas)row.props={people:84,stalls:8,reserved_structure_count:2,people_structure_clearance_verified:true};
  mutate(f.manifest.markets.plazas[0].props);await f.save();assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
});

test('a no-wall market may record zero structures and still recover',async()=>{
  const f=await recoveryFixture();f.manifest.markets.propsEnabled=true;
  for(const row of f.manifest.markets.plazas)row.props={people:84,stalls:8,reserved_structure_count:0,people_structure_clearance_verified:true};
  await f.save();assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,true);
});

test('props-disabled or empty markets do not require structure placement records',async()=>{
  const f=await recoveryFixture();f.manifest.markets.propsEnabled=false;
  for(const row of f.manifest.markets.plazas)row.props={people:84,stalls:8};
  await f.save();assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,true);
  f.manifest.markets.propsEnabled=true;
  for(const row of f.manifest.markets.plazas)row.props={people:0,stalls:0};
  await f.save();assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,true);
});

test('a legacy single market with city walls rebuilds if it predates structure-aware layout',async()=>{
  const f=await recoveryFixture(['m0']);f.town.walls=[{id:'w0',kind:'city',activeSegments:[true]}];
  delete f.manifest.markets;f.manifest.props={people:84,stalls:10};await f.save();
  assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
});

test('a single fortified market requires current structure reservations for every source ID',async()=>{
  const f=await recoveryFixture(['m0']);f.town.walls=[{id:'w0',kind:'castle',activeSegments:[true]}];
  f.manifest.markets.propsEnabled=true;
  f.manifest.markets.plazas[0].props={people:84,stalls:10,reserved_structure_count:12,people_structure_clearance_verified:true};
  await f.save();assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,true);
  delete f.manifest.markets.plazas[0].props.reserved_structure_count;await f.save();assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
  f.manifest.markets.plazas[0].props.reserved_structure_count=12;f.manifest.markets.plazas[0].id='another-market';await f.save();
  assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
});

test('a fortified empty market also needs structure metadata unless props were explicitly disabled',async()=>{
  const f=await recoveryFixture(['m0']);f.town.walls=[{id:'w0',activeSegments:[true]}];f.manifest.markets.propsEnabled=true;
  f.manifest.markets.plazas[0].props={people:0,stalls:0};await f.save();assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
  f.manifest.markets.propsEnabled=false;await f.save();assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,true);
});

test('legacy zero-market scenes keep recovery compatibility even when walls are present',async()=>{
  const f=await recoveryFixture([]);f.town.walls=[{id:'w0',activeSegments:[true]}];delete f.manifest.markets;await f.save();
  assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,true);
});

for(const [name,mutate] of [
  ['legacy singleton manifest',m=>delete m.markets],
  ['old market assembly version',m=>m.markets.version=0],
  ['future unknown market assembly version',m=>m.markets.version=2],
  ['disabled market assembly',m=>m.markets.enabled=false],
  ['missing market identity',m=>m.markets.plazas.pop()],
  ['duplicate market identity',m=>m.markets.plazas[1].id=m.markets.plazas[0].id],
])test(`multi-market recovery rebuilds ${name} from the original plan`,async()=>{
  const f=await recoveryFixture();mutate(f.manifest);await f.save();assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,false);
});

for(const ids of [[],['m0']])test(`legacy ${ids.length}-market recovery remains compatible`,async()=>{
  const f=await recoveryFixture(ids);delete f.manifest.markets;await f.save();assert.equal((await recoveryAssets(f.dir,f.root,f.town)).reuse,true);
});

test('market assembly and per-market verification have independent cache invalidation boundaries',async()=>{
  const root=path.resolve('artifacts/multi-market-unit-tests',randomUUID()),python=path.join(root,'experiments/3d-sample');await fs.mkdir(python,{recursive:true});
  for(const file of await fs.readdir('experiments/3d-sample'))if(file.endsWith('.py'))await fs.writeFile(path.join(python,file),file);
  await fs.writeFile(path.join(python,'export-minimal-town.mjs'),'adapter');
  const towers=path.join(root,'packages/core/dist/wall-towers.js');await fs.mkdir(path.dirname(towers),{recursive:true});await fs.writeFile(towers,'towers');
  let previous=await fingerprints(root);
  for(const name of ['market_placement.py','market_integration.py']) {
    await fs.appendFile(path.join(python,name),' actual assembly change');const next=await fingerprints(root);
    assert.notEqual(next.scene,previous.scene);assert.equal(next.verification,previous.verification);assert.equal(next.rendering,previous.rendering);previous=next;
  }
  await fs.appendFile(path.join(python,'verify_markets.py'),' independent verifier change');const next=await fingerprints(root);
  assert.equal(next.scene,previous.scene);assert.notEqual(next.verification,previous.verification);assert.equal(next.rendering,previous.rendering);
});
