import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateTown, serializeTown } from '@settlement/core';
import { riverSupportError } from '../../apps/playground/shared/three-d-support.mjs';
import { fingerprints, inspectCache, writeSignature, fileHash, townHash } from '../../apps/playground/server/three-d-cache.mjs';

function town(options={}) {
  const result=generateTown({seed:7,size:6,walls:false,castle:false,plaza:true,river:true,...options});
  assert.equal(result.ok,true,JSON.stringify(result));
  return result.town;
}

test('generated inland river plans retain the same supported snapshot for all city features',()=>{
  for(const options of [{},{seed:42,size:12,walls:true},{seed:352656828,size:24,walls:true,castle:true}]) {
    const current=town(options),before=serializeTown(current);
    assert.equal(riverSupportError(current),'');
    assert.equal(serializeTown(current),before,'capability checks must not regenerate or mutate planning');
    for(const bridge of current.river.bridges)assert(bridge.width>current.roads.find(r=>r.id===bridge.roadId).width);
  }
});

test('existing dry and ordinary coastal cities keep their supported capability boundary',()=>{
  assert.equal(riverSupportError(null),'');
  assert.equal(riverSupportError(town({river:false})),'');
  assert.equal(riverSupportError(town({river:false,coast:'east',harbor:true})),'');
});

test('source river mouths are supported for every coast side with and without a harbor',()=>{
  for(const side of ['east','south','west','north']) for(const harbor of [true,false]) {
    const current=town({seed:42,size:12,coast:side,harbor}),before=serializeTown(current);
    assert.equal(riverSupportError(current),'');
    assert.equal(serializeTown(current),before,'enabling an estuary must keep the submitted river, coast and bridges unchanged');
  }
});

test('legacy JSON without the saved actual surface receives a precise capability error',()=>{
  const legacy=town();delete legacy.river.surface;
  const before=JSON.stringify(legacy);
  assert.match(riverSupportError(legacy),/缺少实际河面边界/);
  assert.equal(JSON.stringify(legacy),before,'a rejected legacy map must retain its saved layout');
});

test('a river without its source bridge cannot silently become an unconnected 3D city',()=>{
  const current=town();current.river.bridges=[];
  assert.match(riverSupportError(current),/没有连接两岸的桥梁/);
});

test('missing bridge roads and widths that consume the side structure are rejected',()=>{
  const source=town();
  for(const delta of [.5,0,-.1]) {
    const current=structuredClone(source),bridge=current.river.bridges[0];
    bridge.width=current.roads.find(r=>r.id===bridge.roadId).width+delta;
    assert.match(riverSupportError(current),/结构宽度不足/);
  }
  const missing=structuredClone(source);missing.river.bridges[0].roadId='missing-source-road';
  assert.match(riverSupportError(missing),/结构宽度不足/);
  const minimum=structuredClone(source),bridge=minimum.river.bridges[0];
  bridge.width=minimum.roads.find(r=>r.id===bridge.roadId).width+1;
  assert.equal(riverSupportError(minimum),'','one metre of source-width allowance retains the end-post clearance');
});

test('river resource and assembly changes rebuild scenes while river checks retain scenes',async()=>{
  const root=path.resolve('artifacts/river-support-tests',randomUUID()),python=path.join(root,'experiments/3d-sample');
  await fs.mkdir(python,{recursive:true});
  for(const file of await fs.readdir('experiments/3d-sample'))if(file.endsWith('.py'))await fs.writeFile(path.join(python,file),file);
  await fs.writeFile(path.join(python,'export-minimal-town.mjs'),'unchanged source adapter');
  const tower=path.join(root,'packages/core/dist/wall-towers.js');await fs.mkdir(path.dirname(tower),{recursive:true});await fs.writeFile(tower,'unchanged tower rules');
  const kit=path.join(root,'artifacts/river-assets');await fs.mkdir(kit,{recursive:true});
  await fs.writeFile(path.join(kit,'river-asset-library.blend'),'river kit bytes');
  await fs.writeFile(path.join(kit,'asset-library.json'),'river metadata bytes');
  let previous=await fingerprints(root);
  for(const file of ['river-asset-library.blend','asset-library.json']) {
    await fs.appendFile(path.join(kit,file),' changed');
    const current=await fingerprints(root);
    assert.notEqual(current.scene,previous.scene,`${file} must invalidate existing bridge and bank models`);
    assert.equal(current.verification,previous.verification);assert.equal(current.rendering,previous.rendering);
    previous=current;
  }
  await fs.appendFile(path.join(python,'bridge_integration.py'),' bridge assembly changed');
  const assembled=await fingerprints(root);assert.notEqual(assembled.scene,previous.scene);assert.equal(assembled.rendering,previous.rendering);
  await fs.appendFile(path.join(python,'verify_river.py'),' stronger river validation');
  const checked=await fingerprints(root);assert.equal(checked.scene,assembled.scene);assert.notEqual(checked.verification,assembled.verification);assert.equal(checked.rendering,assembled.rendering);
  await fs.appendFile(path.join(python,'river_geometry.py'),' shared river geometry changed');
  const geometry=await fingerprints(root);assert.notEqual(geometry.scene,checked.scene);assert.notEqual(geometry.verification,checked.verification);
  await fs.appendFile(path.join(python,'estuary_geometry.py'),' shared estuary geometry changed');
  const estuary=await fingerprints(root);assert.notEqual(estuary.scene,geometry.scene);assert.notEqual(estuary.verification,geometry.verification);assert.equal(estuary.rendering,geometry.rendering);
  await fs.appendFile(path.join(python,'verify_estuary.py'),' stronger combined water validation');
  const estuaryChecked=await fingerprints(root);assert.equal(estuaryChecked.scene,estuary.scene);assert.notEqual(estuaryChecked.verification,estuary.verification);assert.equal(estuaryChecked.rendering,estuary.rendering);
  await fs.appendFile(path.join(python,'market_clearance.py'),' updated bridge and water clearance');
  const clearance=await fingerprints(root);assert.notEqual(clearance.scene,estuaryChecked.scene);assert.equal(clearance.verification,estuaryChecked.verification);assert.equal(clearance.rendering,estuaryChecked.rendering);
});

test('a coastal river cache requires its independent combined-water verification',async()=>{
  const current=town({seed:42,size:6,coast:'east',harbor:true});
  const dir=path.resolve('artifacts/estuary-cache-tests',randomUUID());await fs.mkdir(dir,{recursive:true});
  for(const [name,bytes] of Object.entries({'source-town.json':serializeTown(current),'selection.json':'unchanged selection',
    'scene-manifest.json':'unchanged estuary manifest','scene.blend':'saved actual scene','asset-integration.json':'saved asset report'}))await fs.writeFile(path.join(dir,name),bytes);
  const sourceFilesSha256={};for(const name of ['source-town.json','selection.json','scene-manifest.json','scene.blend'])sourceFilesSha256[name]=await fileHash(path.join(dir,name));
  const fingerprint={version:1,scene:'estuary-geometry',verification:'estuary-validation',rendering:'estuary-renderer'};
  const criteria={sourceHash:townHash(current),fingerprint,quality:'high',view:'center'};
  for(const estuary of [undefined,{passed:false},{passed:true}]) {
    await fs.writeFile(path.join(dir,'verification.json'),JSON.stringify({status:'pass',assetIntegration:{passed:true},sourceFilesSha256,estuary}));
    await writeSignature(dir,{...criteria,imageFiles:[]});
    const cached=await inspectCache(dir,criteria);
    assert.equal(Boolean(cached?.scene),estuary?.passed===true,'an older or failed estuary report cannot be treated as validated combined geometry');
  }
});
