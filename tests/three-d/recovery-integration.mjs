// Exercise both retry branches through the normal real-Blender command.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileHash } from '../../apps/playground/server/three-d-cache.mjs';

const root=path.resolve('artifacts/asset-pipeline/recovery-'+randomUUID());await fs.mkdir(root,{recursive:true});
const baseline=path.resolve('artifacts/3d-harbor'),old=path.join(root,'old-assets');await fs.mkdir(old);
for(const file of ['scene.blend','scene-manifest.json','source-town.json','asset-integration.json'])await fs.copyFile(path.join(baseline,file),path.join(old,file));
const manifest=JSON.parse(await fs.readFile(path.join(old,'scene-manifest.json'),'utf8'));
manifest.assetIntegration.additionalLibraries.find(lib=>lib.kitId==='harbor_kit').sha256='previous-version-of-the-harbor-library';
await fs.writeFile(path.join(old,'scene-manifest.json'),JSON.stringify(manifest));
await fs.writeFile(path.join(old,'asset-integration.json'),JSON.stringify(manifest.assetIntegration));
const sourceText=await fs.readFile(path.join(old,'source-town.json'),'utf8');
const expectedMetadata=await fileHash(path.resolve('artifacts/harbor-assets/asset-library.json'));
const checks=[];
async function run(source,name,expectedMode) {
  const dir=path.join(root,name);
  const args=['scripts/generate-3d-sample.mjs','--skip-build','--input',path.join(old,'source-town.json'),'--recover-scene',source,'--output',dir,'--name','scene','--preview'];
  const result=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});
  await fs.writeFile(path.join(root,name+'.log'),(result.stdout??'')+(result.stderr??''));
  assert.equal(result.status,0,(result.stdout??'').slice(-6000)+(result.stderr??'').slice(-1500));
  const report=JSON.parse(await fs.readFile(path.join(dir,'verification.json'),'utf8'));
  const metrics=JSON.parse(await fs.readFile(path.join(dir,'pipeline-performance.json'),'utf8'));
  const assets=JSON.parse(await fs.readFile(path.join(dir,'asset-integration.json'),'utf8'));
  assert.equal(report.status,'pass');assert.equal(metrics.recoveryMode,expectedMode);
  assert.equal(await fs.readFile(path.join(dir,'source-town.json'),'utf8'),sourceText);
  assert(report.harbor.boats.every(b=>b.dryInteriorPassed&&b.waterIntersections.length===0));
  assert.equal(assets.additionalLibraries.find(lib=>lib.kitId==='harbor_kit').manifestSha256,expectedMetadata);
  const phase=expectedMode==='current-assets'?'build_scene':'recover_scene';assert(metrics.phases.some(p=>p.name===phase&&p.status==='complete'));
  checks.push({name,passed:true,recoveryMode:metrics.recoveryMode,sourcePlanPreserved:true,dryBoats:report.harbor.boats.length,sceneDirectory:dir});
  console.log('PASS',name,metrics.recoveryMode);return dir;
}
const refreshed=await run(old,'updated-assets','current-assets');
await run(refreshed,'matching-assets','saved-scene');
const report={passed:true,root,checks};
await fs.writeFile(path.join(root,'verification.json'),JSON.stringify(report,null,2));
await fs.writeFile(path.resolve('artifacts/asset-pipeline/recovery-verification.json'),JSON.stringify(report,null,2));
