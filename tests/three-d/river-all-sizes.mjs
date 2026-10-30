// Real core planning -> complete adapter -> saved meshes -> independent checks
// -> preview images for every size offered by the playground. Stage fingerprints
// and actual file hashes make resumptions explicit and reject stale evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { generateTown, serializeTown, deserializeTown, validateTown } from '@settlement/core';
import { fingerprints, townHash, writeSignature, inspectCache } from '../../apps/playground/server/three-d-cache.mjs';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2);
const values=new Set(['--case','--terrain','--output','--blender','--resolution']);
const flags=new Set(['--prepare-only','--build-only','--verify-only','--render-only','--summary-only','--reuse-plans','--rebuild','--high','--no-render']);
for(let i=0;i<args.length;i++) {
  if(flags.has(args[i]))continue;
  assert.ok(values.has(args[i])&&args[i+1]&&!args[i+1].startsWith('--'),'Unknown option or missing value: '+args[i]);i++;
}
const option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const modes=['prepare','build','verify','render','summary'].filter(mode=>args.includes('--'+mode+'-only'));
assert.ok(modes.length<=1,'Choose at most one stage-only option.');
const mode=modes[0]??'all',reuse=args.includes('--reuse-plans'),rebuild=args.includes('--rebuild');
const noRender=args.includes('--no-render');assert.ok(!(noRender&&mode==='render'),'--render-only cannot be combined with --no-render.');
const high=args.includes('--high'),resolution=high?Number(option('--resolution','3200')):1500;
assert.ok(Number.isInteger(resolution)&&resolution>=256&&resolution<=10000,'Invalid resolution.');
const quality=high?'high':'preview';
const root=path.resolve(workspace,option('--output','artifacts/river-all-sizes'));
const blender=option('--blender',process.env.BLENDER_PATH??'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe');
const sizes=[6,12,24,40,60,80,100];
const allCases=['inland','estuary'].flatMap(kind=>sizes.map(size=>({name:kind+'-'+size,kind,size,
  options:{seed:7,size,river:true,plaza:true,walls:kind==='inland',castle:kind==='inland',
    ...(kind==='estuary'?{coast:'east',harbor:true}:{})}})));
const selected=option('--case',null),terrain=option('--terrain',null);
assert.ok(!terrain||['inland','estuary'].includes(terrain),'Unknown terrain: '+terrain);
const cases=allCases.filter(item=>(!selected||item.name===selected)&&(!terrain||item.kind===terrain));
assert.ok(cases.length,'Unknown case: '+selected);
let current=await fingerprints(workspace);
const prefix=['--background','--factory-startup','--python-exit-code','1','--python'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fileHash=async file=>digest(await fs.readFile(file));
const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const exists=async file=>fs.access(file).then(()=>true,()=>false);
const writeJson=async(file,value)=>fs.writeFile(file,JSON.stringify(value,null,2)+'\n');
await fs.mkdir(root,{recursive:true});
const results=[],failures=[];

async function run(command,argv,file) {
  const started=performance.now();
  const log=await fs.open(file,'w');let tail='';
  try {
    const code=await new Promise((resolve,reject)=>{
      const child=spawn(command,argv,{cwd:workspace,windowsHide:true,
        env:{...process.env,OPTIX_CACHE_PATH:path.join(workspace,'.cache/optix')},stdio:['ignore','pipe','pipe']});
      const collect=chunk=>{tail=(tail+chunk.toString()).slice(-10000);log.write(chunk);};
      child.stdout.on('data',collect);child.stderr.on('data',collect);
      child.once('error',reject);child.once('close',resolve);
    });
    assert.equal(code,0,path.basename(file)+' failed (exit '+code+'):\n'+tail.slice(-8000));
    return (performance.now()-started)/1000;
  } finally {await log.close();}
}
async function hashes(dir,names) {
  return Object.fromEntries(await Promise.all(names.map(async name=>[name,await fileHash(path.join(dir,name))])));
}
async function matchHashes(dir,expected) {
  if(!expected)return false;
  try {for(const [name,hash] of Object.entries(expected))if(await fileHash(path.join(dir,name))!==hash)return false;return true;}
  catch{return false;}
}
const planFiles=['input.json','source-town.json','selection.json'];
const sceneFiles=['source-town.json','selection.json','scene.blend','scene-manifest.json','asset-integration.json'];

async function summarizeSavedCases() {
  const rows=[],errors=[];
  for(const item of cases) {
    const dir=path.join(root,item.name);
    try {
      const saved=await readJson(path.join(dir,'case-result.json'));
      const state=await readJson(path.join(dir,'matrix-state.json'));
      const source=deserializeTown(await fs.readFile(path.join(dir,'source-town.json'),'utf8'));
      const input=deserializeTown(await fs.readFile(path.join(dir,'input.json'),'utf8'));
      const report=await readJson(path.join(dir,'verification.json'));
      validateTown(source);validateTown(input);
      const sourceHash=townHash(source);
      assert.equal(townHash(input),sourceHash,'Original input and saved source differ.');
      assert.equal(source.request.seed,item.options.seed);assert.equal(source.request.size,item.size);
      assert.ok(source.river);assert.equal(source.terrain?.coast?.side,item.options.coast);
      assert.equal(source.resolved.walls,item.options.walls);assert.equal(source.resolved.castle,item.options.castle);
      assert.equal(saved.name,item.name);assert.equal(saved.passed,true);assert.equal(saved.stage,'rendered');
      assert.deepEqual(saved.counts,{buildings:source.buildings.length,roads:source.roads.length,districts:source.districts.length,
        markets:source.districts.filter(d=>d.wardType==='Market').length,bridges:source.river.bridges.length,
        docks:source.terrain?.docks?.length??0,gates:source.gates.length},'Recorded source counts differ from actual planning.');
      assert.deepEqual(saved.verifiedCounts,report.counts,'Recorded verified counts differ from the structural report.');
      for(const field of ['scene','verification','rendering'])assert.equal(saved.fingerprint?.[field],current[field],'Case '+field+' fingerprint is stale.');
      assert.equal(saved.sourceHash,sourceHash);assert.equal(state.prepare?.sourceHash,sourceHash);assert.equal(state.build?.sourceHash,sourceHash);
      assert.equal(state.prepare?.adapterFingerprint,current.scene,'Adapter fingerprint is stale.');
      assert.equal(state.build?.fingerprint,current.scene,'Scene fingerprint is stale.');
      assert.equal(state.verify?.fingerprint,current.verification,'Verification fingerprint is stale.');
      assert.equal(state.render?.fingerprint,current.rendering,'Rendering fingerprint is stale.');
      for(const [phase,required] of [['prepare',planFiles],['build',sceneFiles],['verify',[...sceneFiles,'verification.json']],['render',['scene.blend','verification.json','city-center-render.png']]]) {
        for(const name of required)assert.ok(state[phase]?.hashes?.[name],phase+' has no hash for '+name);
        assert.ok(await matchHashes(dir,state[phase].hashes),phase+' evidence contains a modified or missing file.');
      }
      assert.equal(report.status,'pass');assert.deepEqual(report.failures,[]);
      assert.equal(report.counts.verifiedBuildings,source.buildings.length);
      assert.equal(report.counts.verifiedBridges,source.river.bridges.length);
      assert.equal(report.counts.verifiedMarkets,source.districts.filter(d=>d.wardType==='Market').length);
      for(const category of ['assetIntegration','river','estuary','harbor','markets'])assert.equal(report[category]?.passed,true,category+' did not pass.');
      assert.equal(report.river.enabled,true);assert.equal(report.estuary.enabled,item.kind==='estuary');assert.equal(report.harbor.enabled,item.kind==='estuary');
      assert.deepEqual((report.river.bridges??[]).map(b=>b.id).sort(),source.river.bridges.map(b=>b.id).sort());
      assert.deepEqual(report.markets.plazas.map(p=>p.id).sort(),source.districts.filter(d=>d.wardType==='Market').map(d=>d.id).sort());
      if(item.kind==='estuary')assert.equal(report.harbor.verifiedDocks,source.terrain.docks.length);
      assert.ok(await matchHashes(dir,report.sourceFilesSha256),'Structural report no longer describes its source files.');
      assert.ok(await matchHashes(dir,saved.sourceFilesSha256),'Case result no longer describes its source files.');
      const render=state.render;
      assert.ok(['preview','high'].includes(render.quality),'Unknown saved image quality.');
      assert.ok(Number.isInteger(render.resolution)&&render.resolution>=256&&render.resolution<=10000,'Invalid saved image resolution.');
      if(render.quality==='preview')assert.equal(render.resolution,1500);
      const png=await fs.readFile(path.join(dir,'city-center-render.png'));
      assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),render.resolution);assert.equal(png.readUInt32BE(20),render.resolution);
      assert.equal(saved.quality,render.quality);assert.equal(saved.imageResolution,render.resolution);
      assert.equal(saved.image?.width,render.resolution);assert.equal(saved.image?.height,render.resolution);
      assert.equal(saved.image?.sha256,digest(png),'Case image SHA differs from actual PNG.');
      assert.equal((await inspectCache(dir,{sourceHash,fingerprint:current,quality:render.quality,view:'center',resolution:render.resolution}))?.result,true,'Signed result cache is not current.');
      rows.push({...saved,summaryAudit:{passed:true,checkedAt:new Date().toISOString(),phaseHashesVerified:true,currentFingerprintsVerified:true}});
      console.log('SUMMARY_PASS',item.name,render.quality,render.resolution);
    } catch(error) {
      const failure={name:item.name,size:item.size,kind:item.kind,passed:false,message:error.message};errors.push(failure);console.error('SUMMARY_FAIL',item.name,error.message);
    }
  }
  assert.deepEqual(await fingerprints(workspace),current,'Dependencies changed during summary audit.');
  const qualities=[...new Set(rows.map(row=>row.quality))];
  const result={version:1,passed:errors.length===0,complete:cases.length===allCases.length&&rows.length===allCases.length&&errors.length===0,
    mode:'summary',quality:qualities.length===1?qualities[0]:'mixed',selectedCases:cases.map(item=>item.name),results:rows,failures:errors,allResults:rows,
    totals:{cases:rows.length,buildings:rows.reduce((sum,row)=>sum+row.counts.buildings,0),roads:rows.reduce((sum,row)=>sum+row.counts.roads,0),
      markets:rows.reduce((sum,row)=>sum+row.counts.markets,0),bridges:rows.reduce((sum,row)=>sum+row.counts.bridges,0),docks:rows.reduce((sum,row)=>sum+row.counts.docks,0)},
    completedAt:new Date().toISOString(),fingerprint:current};
  await writeJson(path.join(root,selected?'report-'+selected+'.json':terrain?'report-'+terrain+'.json':'report.json'),result);
  assert.equal(errors.length,0,JSON.stringify(errors,null,2));
  console.log('PASS river all-sizes summary',rows.length,'cases',result.quality,'complete='+result.complete);
}

if(mode==='summary')await summarizeSavedCases();
else {
for(const item of cases) {
  current=await fingerprints(workspace);
  const dir=path.join(root,item.name);await fs.mkdir(dir,{recursive:true});
  const stateFile=path.join(dir,'matrix-state.json'),resultFile=path.join(dir,'case-result.json');
  let state=await readJson(stateFile).catch(()=>({version:1}));
  const seconds={},resumed=[];let stage='prepare';
  console.log('START',item.name,mode,quality);
  try {
    let town;
    if(mode==='verify'||mode==='render'||reuse) {
      town=deserializeTown(await fs.readFile(path.join(dir,'source-town.json'),'utf8'));
    } else {
      const generated=generateTown(item.options);assert.ok(generated.ok,JSON.stringify(generated));town=generated.town;
      const input=serializeTown(town)+'\n',file=path.join(dir,'input.json');
      if(await exists(file))assert.ok(rebuild||(await fs.readFile(file,'utf8'))===input,'Prepared input changed; use --rebuild or preserve it with --reuse-plans.');
      await fs.writeFile(file,input);
    }
    validateTown(town);
    assert.equal(town.request.seed,item.options.seed);assert.equal(town.request.size,item.size);
    assert.ok(town.river,'The source planning contains no river.');
    assert.equal(town.terrain?.coast?.side,item.options.coast);
    assert.equal(town.resolved.walls,item.options.walls);assert.equal(town.resolved.castle,item.options.castle);
    const sourceHash=townHash(town);
    if(mode!=='verify'&&mode!=='render') {
      const old=state.prepare;
      if(!rebuild&&old?.sourceHash===sourceHash&&old.adapterFingerprint===current.scene&&await matchHashes(dir,old.hashes))resumed.push('prepare');
      else {
        if(reuse) {
          const input=path.join(dir,'input.json');
          if(!await exists(input))await fs.writeFile(input,serializeTown(town)+'\n');
          else assert.equal(townHash(deserializeTown(await fs.readFile(input,'utf8'))),sourceHash,'Reusable input differs from saved source.');
        }
        seconds.prepare=await run(process.execPath,['experiments/3d-sample/export-minimal-town.mjs','--input',path.join(dir,'input.json'),'--output',dir],path.join(dir,'prepare.log'));
        assert.equal(townHash(deserializeTown(await fs.readFile(path.join(dir,'source-town.json'),'utf8'))),sourceHash,'Adapter changed source planning.');
        state={version:1,prepare:{sourceHash,adapterFingerprint:current.scene,hashes:await hashes(dir,planFiles),completedAt:new Date().toISOString()}};
        await writeJson(stateFile,state);
      }
    }
    const counts={buildings:town.buildings.length,roads:town.roads.length,districts:town.districts.length,
      markets:town.districts.filter(d=>d.wardType==='Market').length,bridges:town.river.bridges.length,
      docks:town.terrain?.docks?.length??0,gates:town.gates.length};
    const summary={name:item.name,kind:item.kind,size:item.size,options:item.options,sourceHash,counts,
      quality,imageResolution:resolution,seconds,resumed,fingerprint:current};
    if(mode==='prepare') {
      const row={...summary,passed:true,stage:'prepared',sourceFilesSha256:await hashes(dir,planFiles)};
      await writeJson(resultFile,row);results.push(row);console.log('PREPARED',item.name,JSON.stringify(counts));continue;
    }
    stage='build';
    const buildMatches=state.build?.sourceHash===sourceHash&&state.build?.fingerprint===current.scene&&await matchHashes(dir,state.build.hashes);
    if(mode==='verify'||mode==='render')assert.ok(buildMatches,'Scene build evidence is absent, stale or modified; rebuild this case before '+mode+'.');
    else if(!rebuild&&buildMatches)resumed.push('build');
    else {
      const argv=[...prefix,'experiments/3d-sample/render_sample_v2.py','--','--input-dir',dir,'--output-dir',dir,'--name','scene','--frame-entities','--build-only','--resolution',String(resolution)];
      if(!high)argv.push('--preview');
      seconds.build=await run(blender,argv,path.join(dir,'build.log'));
      assert.equal((await fingerprints(workspace)).scene,current.scene,'Scene dependencies changed during this build; rebuild the case.');
      state.build={sourceHash,fingerprint:current.scene,hashes:await hashes(dir,sceneFiles),completedAt:new Date().toISOString()};
      delete state.verify;delete state.render;await writeJson(stateFile,state);
    }
    if(mode==='build') {
      const row={...summary,passed:true,stage:'built',sourceFilesSha256:state.build.hashes};
      await writeJson(resultFile,row);results.push(row);console.log('BUILT',item.name);continue;
    }
    stage='verify';
    const verificationMatches=state.verify?.fingerprint===current.verification&&await matchHashes(dir,state.verify.hashes)&&await matchHashes(dir,state.build.hashes);
    if(!rebuild&&verificationMatches)resumed.push('verify');
    else {
      seconds.verify=await run(blender,[...prefix,'experiments/3d-sample/verify_scene.py','--','--artifact-dir',dir,'--blend',path.join(dir,'scene.blend')],path.join(dir,'verify.log'));
      const verifiedFingerprint=await fingerprints(workspace);
      assert.equal(verifiedFingerprint.scene,current.scene,'Scene dependencies changed during verification; rebuild the case.');
      assert.equal(verifiedFingerprint.verification,current.verification,'Verification dependencies changed during verification; verify again.');
      state.verify={fingerprint:current.verification,hashes:await hashes(dir,[...sceneFiles,'verification.json']),completedAt:new Date().toISOString()};
      delete state.render;await writeJson(stateFile,state);
    }
    const report=await readJson(path.join(dir,'verification.json'));
    assert.equal(report.status,'pass');assert.deepEqual(report.failures,[]);
    assert.equal(report.counts.verifiedBuildings,counts.buildings);assert.equal(report.counts.verifiedBridges,counts.bridges);
    assert.equal(report.counts.verifiedMarkets,counts.markets);
    for(const category of ['assetIntegration','river','estuary','harbor','markets'])assert.equal(report[category].passed,true,category+' did not pass.');
    assert.equal(report.river.enabled,true);assert.equal(report.estuary.enabled,item.kind==='estuary');
    assert.equal(report.harbor.enabled,item.kind==='estuary');
    assert.deepEqual((report.river.bridges??[]).map(b=>b.id).sort(),town.river.bridges.map(b=>b.id).sort());
    assert.deepEqual(report.markets.plazas.map(p=>p.id).sort(),town.districts.filter(d=>d.wardType==='Market').map(d=>d.id).sort());
    if(item.kind==='estuary') {
      assert.equal(report.harbor.verifiedDocks,counts.docks,'Actual docks differ from source planning.');
      assert.ok(report.harbor.verifiedDocks>0,'Requested harbor has no verified docks.');
      assert.ok(report.harbor.boats.length>0,'Requested harbor has no safe actual boat.');
      assert.ok(report.harbor.boats.every(b=>b.dryInteriorPassed&&b.waterIntersections.length===0&&b.missingFloorProbes.length===0),'A boat interior is wet or has no floor.');
    }
    assert.equal(await fileHash(path.join(dir,'scene.blend')),report.sourceFilesSha256['scene.blend']);
    assert.equal(townHash(deserializeTown(await fs.readFile(path.join(dir,'source-town.json'),'utf8'))),sourceHash,'Saved source planning changed.');
    summary.verifiedCounts=report.counts;summary.sourceFilesSha256=report.sourceFilesSha256;
    summary.checks={river:report.river.passed,estuary:report.estuary.passed,harbor:report.harbor.passed,markets:report.markets.passed,assets:report.assetIntegration.passed};
    if(mode!=='verify'&&!noRender) {
      stage='render';
      const renderMatches=state.render?.fingerprint===current.rendering&&state.render?.quality===quality&&state.render?.resolution===resolution&&await matchHashes(dir,state.render.hashes);
      if(!rebuild&&renderMatches)resumed.push('render');
      else {
        const argv=[...prefix,'experiments/3d-sample/render_views.py','--','--blend',path.join(dir,'scene.blend'),'--artifact-dir',dir,'--resolution',String(resolution),'--view','center'];
        if(!high)argv.push('--preview');
        seconds.render=await run(blender,argv,path.join(dir,'render.log'));
        assert.equal((await fingerprints(workspace)).rendering,current.rendering,'Rendering dependencies changed during photography; render again.');
        const image=await fs.readFile(path.join(dir,'city-center-render.png'));
        assert.equal(image.subarray(1,4).toString(),'PNG');assert.equal(image.readUInt32BE(16),resolution);assert.equal(image.readUInt32BE(20),resolution);
        assert.equal(await fileHash(path.join(dir,'scene.blend')),state.build.hashes['scene.blend'],'Rendering altered saved geometry.');
        state.render={fingerprint:current.rendering,quality,resolution,hashes:await hashes(dir,['scene.blend','verification.json','city-center-render.png']),completedAt:new Date().toISOString()};
        await writeJson(stateFile,state);
      }
      await writeSignature(dir,{sourceHash,fingerprint:current,quality,imageFiles:['city-center-render.png']});
      summary.image={file:'city-center-render.png',width:resolution,height:resolution,sha256:await fileHash(path.join(dir,'city-center-render.png'))};
    }
    const row={...summary,passed:true,stage:mode==='verify'||noRender?'verified':'rendered'};
    await writeJson(resultFile,row);results.push(row);console.log('PASS',item.name,counts.buildings,'buildings',counts.bridges,'bridges',counts.markets,'markets',row.stage);
  } catch(error) {
    const row={name:item.name,kind:item.kind,size:item.size,passed:false,stage,message:error.message,seconds,fingerprint:current,failedAt:new Date().toISOString()};
    await writeJson(resultFile,row);failures.push(row);console.error('FAIL',item.name,stage,error.message.slice(-2000));
  }
}
const allResults=[];
current=await fingerprints(workspace);
for(const item of allCases) {
  const value=await readJson(path.join(root,item.name,'case-result.json')).catch(()=>null);
  if(value)allResults.push(value);
}
const currentEvidence=row=>row.passed&&row.stage==='rendered'&&row.fingerprint?.scene===current.scene&&row.fingerprint?.verification===current.verification&&row.fingerprint?.rendering===current.rendering;
const matrix={version:1,passed:failures.length===0,complete:allResults.length===allCases.length&&allResults.every(currentEvidence),
  mode,quality,selectedCases:cases.map(item=>item.name),results,failures,allResults,completedAt:new Date().toISOString(),fingerprint:current};
await writeJson(path.join(root,selected?'report-'+selected+'.json':terrain?'report-'+terrain+'.json':'report.json'),matrix);
assert.equal(failures.length,0,JSON.stringify(failures.map(({name,stage,message})=>({name,stage,message})),null,2));
console.log('PASS river all-sizes',results.length,'cases',mode,'complete='+matrix.complete);
}
