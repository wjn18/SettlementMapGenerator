// Real, saved Blender scenes for all four coast directions, no-port and inland.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateTown,serializeTown } from '@settlement/core';
const blender=process.env.BLENDER_PATH??'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const root=path.resolve('artifacts/harbor-tests');await fs.mkdir(root,{recursive:true});
const verifyOnly=process.argv.includes('--verify-only');
function run(command,args,file) {
  const r=spawnSync(command,args,{encoding:'utf8',windowsHide:true,env:{...process.env,OPTIX_CACHE_PATH:path.resolve('.cache/optix')},maxBuffer:32*1024*1024});
  const output=(r.stdout??'')+(r.stderr??'');return fs.writeFile(file,output).then(()=>assert.equal(r.status,0,output.slice(-7000)));
}
const cases=[...['east','south','west','north'].map(coast=>({name:coast,coast,harbor:true,walls:coast==='south',castle:coast==='south'})),{name:'coast-no-port',coast:'west',harbor:false},{name:'inland'}];
const results=[];
for(const c of cases) {
  const dir=path.join(root,c.name);await fs.mkdir(dir,{recursive:true});
  const {name,...terrain}=c;const r=generateTown({seed:7,size:6,plaza:true,walls:false,castle:false,...terrain});assert(r.ok,JSON.stringify(r));
  await fs.writeFile(path.join(dir,'input.json'),serializeTown(r.town));
  const prefix=['--background','--factory-startup','--python-exit-code','1','--python'];
  if(!verifyOnly) {
    await run(process.execPath,['experiments/3d-sample/export-minimal-town.mjs','--input',path.join(dir,'input.json'),'--output',dir],path.join(dir,'export.log'));
    await run(blender,[...prefix,'experiments/3d-sample/render_sample_v2.py','--','--input-dir',dir,'--output-dir',dir,'--name','scene','--build-only','--frame-entities','--preview'],path.join(dir,'build.log'));
  }
  await run(blender,[...prefix,'experiments/3d-sample/verify_scene.py','--','--artifact-dir',dir,'--blend',path.join(dir,'scene.blend')],path.join(dir,'verify.log'));
  const v=JSON.parse(await fs.readFile(path.join(dir,'verification.json'),'utf8'));
  assert.equal(v.status,'pass');assert.equal(v.harbor.passed,true);assert.equal(v.harbor.enabled,Boolean(c.coast));assert.equal(v.counts.verifiedBuildings,r.town.buildings.length);
  if(c.harbor){assert(v.harbor.verifiedDocks>0);assert(v.harbor.boats.length>0);assert(v.harbor.warehouseComponents>0);}
  if(c.harbor)assert(v.harbor.boats.every(b=>b.dryInteriorPassed&&b.interiorProbes===15&&b.waterIntersections.length===0&&b.missingFloorProbes.length===0));
  if(c.coast&&!c.harbor){assert.equal(v.harbor.verifiedDocks,0);assert.equal(v.harbor.boats.length,0);}
  results.push({name,status:v.status,buildings:v.counts.verifiedBuildings,harbor:v.harbor});
  console.log('PASS',name,v.counts.verifiedBuildings,'buildings',v.harbor.verifiedDocks??0,'docks');
}
await fs.writeFile(path.join(root,'report.json'),JSON.stringify({passed:true,results},null,2));
