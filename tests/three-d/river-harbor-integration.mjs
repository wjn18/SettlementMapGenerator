import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { generateTown,serializeTown } from '@settlement/core';
const blender=process.env.BLENDER_PATH??'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const prefix=['--background','--factory-startup','--python-exit-code','1','--python'];
async function run(command,args,file){
  const output=[];const code=await new Promise((resolve,reject)=>{const p=spawn(command,args,{windowsHide:true,env:{...process.env,OPTIX_CACHE_PATH:path.resolve('.cache/optix')}});p.stdout.on('data',d=>output.push(d));p.stderr.on('data',d=>output.push(d));p.on('error',reject);p.on('close',resolve);});
  const text=Buffer.concat(output).toString();await fs.writeFile(file,text);assert.equal(code,0,text.slice(-6500));
}
const cases=[{name:'3d-river-harbor',size:12,coast:false},{name:'3d-estuary-river-harbor',size:24,coast:'east'}];
for(const sample of cases){
  const dir=path.resolve('artifacts',sample.name);await fs.mkdir(dir,{recursive:true});
  const result=generateTown({seed:7,size:sample.size,river:true,riverHarbor:true,coast:sample.coast,harbor:true,walls:false,castle:false,plaza:true});assert(result.ok,JSON.stringify(result));
  if(!process.argv.includes('--verify-only')){
    await fs.writeFile(path.join(dir,'input-town.json'),serializeTown(result.town));
    await run(process.execPath,['experiments/3d-sample/export-minimal-town.mjs','--input',path.join(dir,'input-town.json'),'--output',dir],path.join(dir,'export.log'));
    console.log('Exported',sample.name);
    await run(blender,[...prefix,'experiments/3d-sample/render_sample_v2.py','--','--input-dir',dir,'--output-dir',dir,'--name','scene','--build-only','--preview','--frame-entities'],path.join(dir,'build.log'));
    console.log('Built',sample.name);
  }
  await run(blender,[...prefix,'experiments/3d-sample/verify_scene.py','--','--artifact-dir',dir,'--blend',path.join(dir,'scene.blend')],path.join(dir,'verify.log'));
  const report=JSON.parse(await fs.readFile(path.join(dir,'verification.json'),'utf8'));
  assert.equal(report.status,'pass');assert.equal(report.harbor.riverHarbor.passed,true);
  assert.equal(report.harbor.riverHarbor.verifiedDocks,result.town.terrain.docks.filter(d=>d.waterbody==='river').length);
  assert(report.harbor.boats.some(b=>b.waterbody==='river'&&b.dryInteriorPassed));
  if(sample.coast)assert.equal(report.estuary.passed,true);
  console.log('PASS',sample.name,report.harbor.verifiedDocks,'docks');
}
