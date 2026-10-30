// Imported zero/one/near/far market plans -> saved meshes -> independent checks.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { deserializeTown } from '@settlement/core';
import { marketCases, writeMarketFixtures } from './multi-market-fixtures.mjs';

const args=process.argv.slice(2),option=(name,fallback)=>{const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing value for '+name);return args[i+1];};
const root=path.resolve(option('--output','artifacts/multi-market-tests'));
const selected=option('--case',null),verifyOnly=args.includes('--verify-only'),reusePlans=args.includes('--reuse-plans'),buildOnly=args.includes('--build-only');
assert.ok(!(verifyOnly&&buildOnly));
const cases=marketCases.filter(c=>c.name!=='main'&&(!selected||c.name===selected));assert.ok(cases.length,'Unknown regression case: '+selected);
if(!verifyOnly&&!reusePlans) {
  const complete=await Promise.all(cases.map(c=>fs.access(path.join(root,c.name,'input.json')).then(()=>true,()=>false)));
  if(args.includes('--prepare')||complete.some(v=>!v))await writeMarketFixtures({root});
}
const blender=process.env.BLENDER_PATH??'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const prefix=['--background','--factory-startup','--python-exit-code','1','--python'];
const results=[],failures=[];
async function run(command,argv,file) {
  const started=performance.now();let output='';
  const code=await new Promise((resolve,reject)=>{const child=spawn(command,argv,{windowsHide:true,env:{...process.env,OPTIX_CACHE_PATH:path.resolve('.cache/optix')},stdio:['ignore','pipe','pipe']});child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);child.once('error',reject);child.once('close',resolve);});
  await fs.writeFile(file,output);assert.equal(code,0,output.slice(-9000));return (performance.now()-started)/1000;
}
for(const item of cases) {
  const dir=path.join(root,item.name);await fs.mkdir(dir,{recursive:true});const seconds={};
  console.log('START',item.name,verifyOnly?'verify-only':'build-and-verify');
  try {
    let town;
    if(verifyOnly||reusePlans)town=deserializeTown(await fs.readFile(path.join(dir,'source-town.json'),'utf8'));
    else {
      town=deserializeTown(await fs.readFile(path.join(dir,'input.json'),'utf8'));
      seconds.export=await run(process.execPath,['experiments/3d-sample/export-minimal-town.mjs','--input',path.join(dir,'input.json'),'--output',dir],path.join(dir,'export.log'));
    }
    const ids=town.districts.filter(d=>d.wardType==='Market').map(d=>d.id).sort();
    if(!verifyOnly)seconds.build=await run(blender,[...prefix,'experiments/3d-sample/render_sample_v2.py','--','--input-dir',dir,'--output-dir',dir,'--name','scene','--build-only','--frame-entities','--preview'],path.join(dir,'build.log'));
    if(buildOnly){results.push({name:item.name,built:true,marketIds:ids,seconds});continue;}
    seconds.verify=await run(blender,[...prefix,'experiments/3d-sample/verify_scene.py','--','--artifact-dir',dir,'--blend',path.join(dir,'scene.blend')],path.join(dir,'verify.log'));
    const report=JSON.parse(await fs.readFile(path.join(dir,'verification.json'),'utf8'));
    const manifest=JSON.parse(await fs.readFile(path.join(dir,'scene-manifest.json'),'utf8'));
    const source=deserializeTown(await fs.readFile(path.join(dir,'source-town.json'),'utf8'));
    assert.deepEqual(source,town);assert.equal(report.status,'pass');assert.deepEqual(report.failures,[]);
    assert.equal(report.markets.version,1);assert.equal(report.markets.passed,true);
    assert.deepEqual(report.markets.plazas.map(p=>p.id).sort(),ids);
    assert.ok(report.markets.plazas.every(p=>p.passed));
    assert.deepEqual(manifest.markets.plazas.map(p=>p.id).sort(),ids);
    assert.equal(report.river.passed,true);assert.equal(report.counts.verifiedBridges,town.river.bridges.length);
    assert.equal(report.assetIntegration.passed,true);assert.equal(report.assetIntegration.citizens.passed,true);
    assert.equal(report.counts.verifiedBuildings,town.buildings.length);
    const sceneSha=createHash('sha256').update(await fs.readFile(path.join(dir,'scene.blend'))).digest('hex');assert.equal(sceneSha,report.sourceFilesSha256['scene.blend']);
    results.push({name:item.name,passed:true,marketIds:ids,buildings:town.buildings.length,
      perMarket:report.markets.plazas.map(p=>({id:p.id,passed:p.passed,counts:p.counts})),sourceFilesSha256:report.sourceFilesSha256,seconds});
    console.log('PASS',item.name,ids.length,'markets',town.buildings.length,'buildings');
  } catch(error){failures.push({name:item.name,error:error.message});console.error('FAIL',item.name,error.message.slice(-1400));}
}
const report={passed:!failures.length,cases:cases.map(c=>c.name),verifyOnly,buildOnly,results,failures};
await fs.writeFile(path.join(root,selected?'report-'+selected+'.json':'report.json'),JSON.stringify(report,null,2));
assert.equal(failures.length,0,JSON.stringify(failures,null,2));console.log('PASS multi-market matrix',results.length,'cases');
