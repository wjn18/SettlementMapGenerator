// Real adapter -> saved Blender mesh -> independent verification matrix.
// No images are rendered. --build-only and --verify-only split expensive work;
// --case <name> permits a bounded repair/recheck without replaying other cases.
// --reuse-plans rebuilds existing snapshots without another 2D export/render.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { generateTown, serializeTown, deserializeTown } from '@settlement/core';

const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error('Missing value for '+name);return args[i+1];};
const root=path.resolve(option('--output','artifacts/estuary-tests'));
const blender=process.env.BLENDER_PATH??'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const verifyOnly=args.includes('--verify-only'),buildOnly=args.includes('--build-only');
const reusePlans=args.includes('--reuse-plans');
assert.ok(!(verifyOnly&&buildOnly),'Choose either --build-only or --verify-only.');
const allCases=[...['east','south','west','north'].map(coast=>({name:coast,coast,river:true,harbor:true,walls:coast==='south',castle:coast==='south'})),
  {name:'west-no-port',coast:'west',river:true,harbor:false},
  {name:'inland-river',river:true},
  {name:'coast-only',coast:'east',harbor:true,river:false}];
const selected=option('--case',null),cases=selected?allCases.filter(c=>c.name===selected):allCases;
assert.ok(cases.length,'Unknown matrix case: '+selected);
await fs.mkdir(root,{recursive:true});
const prefix=['--background','--factory-startup','--python-exit-code','1','--python'];
const results=[],failures=[];
async function run(command,argv,file) {
  const started=performance.now();
  const result=await new Promise((resolve,reject)=>{
    let output='';
    const child=spawn(command,argv,{windowsHide:true,env:{...process.env,OPTIX_CACHE_PATH:path.resolve('.cache/optix')},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',chunk=>{output+=chunk.toString();});
    child.stderr.on('data',chunk=>{output+=chunk.toString();});
    child.once('error',reject);child.once('close',code=>resolve({code,output}));
  });
  await fs.writeFile(file,result.output);
  assert.equal(result.code,0,result.output.slice(-8000));
  return (performance.now()-started)/1000;
}
for(const c of cases) {
  const dir=path.join(root,c.name);await fs.mkdir(dir,{recursive:true});
  const {name,...terrain}=c;
  const seconds={};
  console.log('START',name,verifyOnly?'verify-only':buildOnly?'build-only':'build-and-verify');
  try {
    let town;
    if(verifyOnly||reusePlans)town=deserializeTown(await fs.readFile(path.join(dir,'source-town.json'),'utf8'));
    else {
      const generated=generateTown({seed:7,size:6,plaza:true,walls:false,castle:false,...terrain});
      assert.ok(generated.ok,JSON.stringify(generated));town=generated.town;
      await fs.writeFile(path.join(dir,'input.json'),serializeTown(town));
      seconds.export=await run(process.execPath,['experiments/3d-sample/export-minimal-town.mjs','--input',path.join(dir,'input.json'),'--output',dir],path.join(dir,'export.log'));
    }
    assert.equal(town.request.seed,7);assert.equal(town.request.size,6);
    assert.equal(Boolean(town.river),Boolean(c.river));assert.equal(town.terrain?.coast?.side,c.coast);
    if(!verifyOnly)seconds.build=await run(blender,[...prefix,'experiments/3d-sample/render_sample_v2.py','--','--input-dir',dir,'--output-dir',dir,'--name','scene','--build-only','--frame-entities','--preview'],path.join(dir,'build.log'));
    if(buildOnly){results.push({name,built:true,seconds});console.log('BUILT',name);continue;}
    seconds.verify=await run(blender,[...prefix,'experiments/3d-sample/verify_scene.py','--','--artifact-dir',dir,'--blend',path.join(dir,'scene.blend')],path.join(dir,'verify.log'));
    const report=JSON.parse(await fs.readFile(path.join(dir,'verification.json'),'utf8'));
    const manifest=JSON.parse(await fs.readFile(path.join(dir,'scene-manifest.json'),'utf8'));
    const source=deserializeTown(await fs.readFile(path.join(dir,'source-town.json'),'utf8'));
    assert.deepEqual(source,town,'Source planning changed during assembly.');
    assert.equal(report.status,'pass');assert.deepEqual(report.failures,[]);
    assert.equal(report.harbor.enabled,Boolean(c.coast));assert.equal(report.harbor.passed,true);
    assert.equal(report.river.enabled,Boolean(c.river));assert.equal(report.river.passed,true);
    assert.equal(report.estuary.enabled,Boolean(c.river&&c.coast));assert.equal(report.estuary.passed,true);
    assert.equal(report.counts.verifiedBuildings,town.buildings.length);
    assert.equal(report.counts.verifiedBridges,town.river?.bridges.length??0);
    assert.deepEqual((report.river.bridges??[]).map(b=>b.id).sort(),(town.river?.bridges??[]).map(b=>b.id).sort());
    assert.equal(manifest.river.enabled,Boolean(c.river));
    if(c.harbor) {
      assert.ok(report.harbor.verifiedDocks>0,'The requested harbor lost its source docks.');
      assert.ok(report.harbor.boats.length>0,'No actual boat received a safe berth.');
      assert.ok(report.harbor.warehouseComponents>0,'Requested harbor warehouses lack actual components.');
      assert.ok(report.harbor.boats.every(b=>b.dryInteriorPassed&&b.interiorProbes===15&&
        b.waterIntersections.length===0&&b.missingFloorProbes.length===0),'Boat interiors contain water or have no continuous floor.');
    } else if(c.coast) {
      assert.equal(report.harbor.verifiedDocks,0);assert.equal(report.harbor.boats.length,0);
    }
    const sceneSha=createHash('sha256').update(await fs.readFile(path.join(dir,'scene.blend'))).digest('hex');
    assert.equal(sceneSha,report.sourceFilesSha256['scene.blend'],'Report does not describe the current saved scene.');
    results.push({name,status:report.status,buildings:report.counts.verifiedBuildings,
      bridges:report.counts.verifiedBridges,docks:report.harbor.verifiedDocks??0,
      boats:report.harbor.boats?.length??0,estuary:report.estuary.enabled,
      sourceFilesSha256:report.sourceFilesSha256,seconds});
    console.log('PASS',name,report.counts.verifiedBuildings,'buildings',report.counts.verifiedBridges,'bridges',report.harbor.verifiedDocks??0,'docks');
  } catch(error) {
    failures.push({name,message:error.message});
    console.error('FAIL',name,error.message.slice(-1500));
  }
}
const report={passed:failures.length===0,buildOnly,verifyOnly,selectedCases:cases.map(c=>c.name),results,failures};
await fs.writeFile(path.join(root,buildOnly?'build-report.json':selected?'report-'+selected+'.json':'report.json'),JSON.stringify(report,null,2));
assert.equal(failures.length,0,JSON.stringify(failures,null,2));
console.log('PASS estuary matrix',results.length,'cases');
