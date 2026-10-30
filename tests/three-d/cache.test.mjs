import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { generateTown,serializeTown } from '@settlement/core';
import { inspectCache,writeSignature,fileHash,townHash,copyArtifacts,fingerprints } from '../../apps/playground/server/three-d-cache.mjs';

const root=path.resolve('artifacts/3d-performance/cache-tests');await fs.mkdir(root,{recursive:true});
const generated=generateTown({seed:7,size:6,walls:true,castle:false,plaza:true});assert(generated.ok);
const town=generated.town,fp={version:1,scene:'geometry-1',verification:'checks-1',rendering:'render-1'};
async function fixture() {
  const dir=path.join(root,randomUUID());await fs.mkdir(dir);
  const files={'source-town.json':serializeTown(town)+'\n','selection.json':'{"source":"exact"}',
    'scene-manifest.json':'{"buildings":[]}','scene.blend':'immutable scene bytes','asset-integration.json':'{"enabled":true}',
    'planning.svg':'<svg/>','planning.png':'planning image','city-center-render.png':'native render image'};
  for(const [name,bytes] of Object.entries(files))await fs.writeFile(path.join(dir,name),bytes);
  await fs.writeFile(path.join(dir,'city-center-render.png'),PNG.sync.write(new PNG({width:2,height:2})));
  const sha={};for(const name of ['source-town.json','selection.json','scene-manifest.json','scene.blend'])sha[name]=await fileHash(path.join(dir,name));
  await fs.writeFile(path.join(dir,'verification.json'),JSON.stringify({status:'pass',sourceFilesSha256:sha,assetIntegration:{passed:true},counts:{verifiedBuildings:107}}));
  await writeSignature(dir,{sourceHash:townHash(town),fingerprint:fp,quality:'high'});
  return {dir,criteria:{sourceHash:townHash(town),fingerprint:fp,quality:'high',view:'center',resolution:2}};
}

test('same source, scene bytes, verifier, renderer, quality and view reuse a finished result',async()=>{
  const {dir,criteria}=await fixture(),hit=await inspectCache(dir,criteria);
  assert(hit.scene&&hit.result&&hit.sameVerifier);
  const destination=path.join(root,randomUUID());await fs.mkdir(destination);
  await copyArtifacts(dir,destination,{images:true});assert((await inspectCache(destination,criteria)).result);
  assert.deepEqual(await fs.readFile(path.join(dir,'scene.blend')),await fs.readFile(path.join(destination,'scene.blend')));
});

test('unsigned or damaged views are never copied into a result for the current plan',async()=>{
  const {dir,criteria}=await fixture(),destination=path.join(root,randomUUID());await fs.mkdir(destination);
  await fs.writeFile(path.join(dir,'scene-render.png'),'stale photograph from another plan');
  await copyArtifacts(dir,destination,{images:true,view:'center'});
  await assert.rejects(fs.access(path.join(destination,'scene-render.png')));
  assert((await inspectCache(destination,criteria)).result);
  const signature=JSON.parse(await fs.readFile(path.join(destination,'cache-signature.json'),'utf8'));
  assert.deepEqual(Object.keys(signature.images),['city-center-render.png']);
});

test('only views produced in this run are signed when an output folder contains older pictures',async()=>{
  const {dir,criteria}=await fixture();await fs.writeFile(path.join(dir,'scene-render.png'),PNG.sync.write(new PNG({width:2,height:2})));
  await writeSignature(dir,{sourceHash:criteria.sourceHash,fingerprint:fp,quality:'high',imageFiles:['city-center-render.png']});
  const hit=await inspectCache(dir,{...criteria,view:'full'});assert(hit.scene);assert.equal(hit.result,false);
});

for(const [label,mutate] of [
  ['quality',c=>({...c,quality:'preview'})],['view',c=>({...c,view:'castle'})],
  ['resolution',c=>({...c,resolution:4})],
  ['renderer',c=>({...c,fingerprint:{...fp,rendering:'render-2'}})],
  ['verifier',c=>({...c,fingerprint:{...fp,verification:'checks-2'}})],
])test(`changing ${label} retains the scene and requires a new photograph/check`,async()=>{
  const {dir,criteria}=await fixture(),hit=await inspectCache(dir,mutate(criteria));assert(hit.scene);assert.equal(hit.result,false);
  if(label==='verifier')assert.equal(hit.sameVerifier,false);
});

for(const name of ['source-town.json','selection.json','scene-manifest.json','scene.blend','asset-integration.json'])
  test(`changed ${name} cannot be reused`,async()=>{
    const {dir,criteria}=await fixture();await fs.appendFile(path.join(dir,name),' altered');assert.equal(await inspectCache(dir,criteria),null);
  });

test('a different planning snapshot or geometry/library signature cannot share a scene',async()=>{
  const {dir,criteria}=await fixture();
  assert.equal(await inspectCache(dir,{...criteria,sourceHash:'other-source'}),null);
  assert.equal(await inspectCache(dir,{...criteria,fingerprint:{...fp,scene:'new-geometry-or-library'}}),null);
});

for(const remove of [false,true])test(`${remove?'missing':'corrupt'} picture invalidates only the photograph`,async()=>{
  const {dir,criteria}=await fixture();
  if(remove)await fs.unlink(path.join(dir,'city-center-render.png'));else await fs.appendFile(path.join(dir,'city-center-render.png'),'corrupt');
  const hit=await inspectCache(dir,criteria);assert(hit.scene);assert.equal(hit.result,false);
});

test('failed verification never becomes a cache hit',async()=>{
  const {dir,criteria}=await fixture();const p=path.join(dir,'verification.json'),v=JSON.parse(await fs.readFile(p,'utf8'));v.status='fail';await fs.writeFile(p,JSON.stringify(v));
  assert.equal(await inspectCache(dir,criteria),null);
});

test('rewriting a scene and its verification report still invalidates the original cache signature',async()=>{
  const {dir,criteria}=await fixture();await fs.appendFile(path.join(dir,'scene.blend'),' changed');
  const report=JSON.parse(await fs.readFile(path.join(dir,'verification.json'),'utf8'));
  report.sourceFilesSha256['scene.blend']=await fileHash(path.join(dir,'scene.blend'));
  await fs.writeFile(path.join(dir,'verification.json'),JSON.stringify(report));
  assert.equal(await inspectCache(dir,criteria),null);
});

test('real dependency fingerprints isolate geometry, verification and rendering changes',async()=>{
  const dir=path.join(root,randomUUID()),python=path.join(dir,'experiments/3d-sample');await fs.mkdir(python,{recursive:true});
  for(const file of await fs.readdir('experiments/3d-sample'))if(file.endsWith('.py'))await fs.writeFile(path.join(python,file),file);
  await fs.writeFile(path.join(python,'export-minimal-town.mjs'),'adapter');
  const towerModule=path.join(dir,'packages/core/dist/wall-towers.js');await fs.mkdir(path.dirname(towerModule),{recursive:true});await fs.writeFile(towerModule,'tower rules');
  const a=await fingerprints(dir);
  await fs.appendFile(path.join(python,'render_views.py'),'renderer edit');const b=await fingerprints(dir);
  assert.equal(a.scene,b.scene);assert.equal(a.verification,b.verification);assert.notEqual(a.rendering,b.rendering);
  await fs.appendFile(path.join(python,'verify_scene.py'),'check edit');const c=await fingerprints(dir);
  assert.equal(b.scene,c.scene);assert.notEqual(b.verification,c.verification);
  await fs.appendFile(path.join(python,'buildings_v2.py'),'geometry edit');const d=await fingerprints(dir);
  assert.notEqual(c.scene,d.scene);assert.equal(c.rendering,d.rendering);
  const library=path.join(dir,'artifacts/small-town-assets');await fs.mkdir(library,{recursive:true});await fs.writeFile(path.join(library,'small-town-asset-library.blend'),'changed library');
  const e=await fingerprints(dir);assert.notEqual(d.scene,e.scene);assert.equal(d.verification,e.verification);
  await fs.appendFile(towerModule,'spacing update');const f=await fingerprints(dir);assert.notEqual(e.scene,f.scene);assert.equal(e.verification,f.verification);
  await fs.appendFile(path.join(python,'planar_coverage.py'),'coverage precision update');const g=await fingerprints(dir);
  assert.equal(f.scene,g.scene);assert.notEqual(f.verification,g.verification);assert.equal(f.rendering,g.rendering);
});
