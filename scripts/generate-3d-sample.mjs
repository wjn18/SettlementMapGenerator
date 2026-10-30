import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { deserializeTown } from '@settlement/core';
import { fingerprints, inspectCache, copyArtifacts, townHash, writeSignature, imageForView } from '../apps/playground/server/three-d-cache.mjs';
import { recoveryAssets } from '../apps/playground/server/three-d-assets.mjs';
import { townOptionFlags,readTownOptions } from './three-d-options.mjs';
import { riverSupportError } from '../apps/playground/shared/three-d-support.mjs';

async function main() {
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),options={};
const valued=new Set(['--input','--output',...townOptionFlags,'--blender','--resolution','--name','--asset-library','--recover-scene','--reuse-scene','--view']);
const flags=new Set(['--preview','--skip-build','--help','--legacy-assets','--details']);
for(let i=0;i<args.length;i++) {
  const arg=args[i];
  if(flags.has(arg))options[arg]=true;
  else if(valued.has(arg)&&args[i+1]&&!args[i+1].startsWith('--'))options[arg]=args[++i];
  else throw new Error(`Unknown option or missing value: ${arg}`);
}
if(options['--help']) {console.log('npm run sample:3d -- [--input town.json | --seed 7 --size 6 --coast east --harbor true --river false --river-harbor false --walls true --castle false --plaza true] [--output directory] [--name scene] [--preview] [--view center|full|castle] [--details] [--reuse-scene verified-directory] [--recover-scene failed-directory] [--resolution 3200] [--skip-build]');return;}
readTownOptions(args);
const view=options['--view']??'center';
if(!['center','full','castle'].includes(view))throw new Error('Unknown view.');
const out=path.resolve(root,options['--output']??'artifacts/3d-minimal-city'),name=options['--name']??'minimal-city';
if(!/^[a-z0-9][a-z0-9_-]*$/i.test(name))throw new Error('--name must be a simple filename stem.');
const blender=options['--blender']??process.env.BLENDER_PATH??(process.platform==='win32'?'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe':'blender');
const env={...process.env,OPTIX_CACHE_PATH:process.env.OPTIX_CACHE_PATH??path.join(root,'.cache/optix')};
await fs.mkdir(env.OPTIX_CACHE_PATH,{recursive:true});await fs.mkdir(out,{recursive:true});
const started=performance.now(),quality=options['--preview']?'preview':'high';
const metrics={version:1,startedAt:new Date().toISOString(),quality,requestedView:view,cacheHit:'none',phases:[]};
const saveMetrics=async()=>{metrics.seconds=(performance.now()-started)/1000;await fs.writeFile(path.join(out,'pipeline-performance.json'),JSON.stringify(metrics,null,2));};
const cancelled=()=>Boolean(process.env.SETTLEMENT_CANCEL_FILE&&existsSync(process.env.SETTLEMENT_CANCEL_FILE));
async function phase(label,action) {
  if(cancelled())throw new Error('Generation cancelled');
  const t=performance.now(),row={name:label,status:'running'};metrics.phases.push(row);
  try {const value=await action();row.status='complete';return value;}
  catch(e){row.status='failed';row.error=e.message;throw e;}
  finally {row.seconds=(performance.now()-t)/1000;await saveMetrics();console.log('PIPELINE_PHASE '+JSON.stringify(row));}
}
async function run(command,argv,label) {
  return phase(label,async()=>{
    console.log(path.basename(command)+' '+argv.join(' '));
    await new Promise((resolve,reject)=>{
      const child=spawn(command,argv,{cwd:root,env,stdio:'inherit',windowsHide:true});
      const timer=command===blender&&process.env.SETTLEMENT_CANCEL_FILE?setInterval(()=>{if(cancelled())child.kill();},400):null;
      const clear=()=>{if(timer)clearInterval(timer);};
      child.on('error',e=>{clear();reject(e);});
      child.on('exit',code=>{clear();cancelled()?reject(new Error('Generation cancelled')):code===0?resolve():reject(new Error(`${command} exited ${code}`));});
    });
  });
}
if(!options['--skip-build']) {
  if(!process.env.npm_execpath)throw new Error('Run via npm run sample:3d, or use --skip-build after building packages.');
  await run(process.execPath,[process.env.npm_execpath,'run','build:packages'],'packages');
}
const fingerprint=await phase('dependency_fingerprints',()=>fingerprints(root));
let cache=null;
if(options['--reuse-scene']) {
  if(!options['--input']||options['--recover-scene'])throw new Error('Scene reuse requires --input and cannot be combined with recovery.');
  const town=deserializeTown(await fs.readFile(path.resolve(root,options['--input']),'utf8'));
  metrics.sourceHash=townHash(town);
  cache=await phase('validate_cache',()=>inspectCache(path.resolve(root,options['--reuse-scene']),{sourceHash:metrics.sourceHash,fingerprint,quality,view,resolution:Number(options['--resolution']??3200)}));
  if(!cache)throw new Error('The saved scene, source or dependencies changed; build a fresh scene.');
  await phase('copy_scene',()=>copyArtifacts(cache.dir,out,{images:cache.result&&!options['--details'],view}));
  metrics.cacheHit=cache.result&&!options['--details']?'result':'scene';metrics.reusedFrom=path.basename(cache.dir);
  if(metrics.cacheHit==='result') {
    if(!(await inspectCache(out,{sourceHash:metrics.sourceHash,fingerprint,quality,view,resolution:Number(options['--resolution']??3200)}))?.result)throw new Error('Copied cache artifacts changed; rebuild the scene.');
    metrics.counts=JSON.parse(await fs.readFile(path.join(out,'verification.json'),'utf8')).counts;await saveMetrics();console.log('CACHED_RESULT_READY');return;
  }
} else {
  const adapter=['experiments/3d-sample/export-minimal-town.mjs','--output',out];
  for(const key of ['--input',...townOptionFlags])if(options[key])adapter.push(key,options[key]);
  await run(process.execPath,adapter,'export_2d');
}
const selection=JSON.parse(await fs.readFile(path.join(out,'selection.json'),'utf8'));
const source=deserializeTown(await fs.readFile(path.join(out,'source-town.json'),'utf8'));metrics.sourceHash=townHash(source);
const unsupportedRiver=riverSupportError(source);if(unsupportedRiver)throw new Error(unsupportedRiver);
if(selection.features.some(f=>!['grove','statue','fountain'].includes(f.kind)))throw new Error('This 3D adapter supports grove/statue/fountain features.');
if((source.terrain?.coast||source.river)&&options['--legacy-assets'])throw new Error('Waterfront cities require the authored asset libraries.');
if(!cache) {
  let recover=options['--recover-scene'];
  if(recover) {
    const previous=path.resolve(root,recover);
    const savedSource=deserializeTown(await fs.readFile(path.join(previous,'source-town.json'),'utf8'));
    if(townHash(savedSource)!==metrics.sourceHash)throw new Error('Saved scene recovery requires an identical source planning snapshot.');
    if(!options['--legacy-assets']) {
      const decision=await phase('recovery_assets',()=>recoveryAssets(previous,root,source,{assetLibrary:options['--asset-library']?path.resolve(root,options['--asset-library']):undefined}));
      metrics.recoveryMode=decision.reuse?'saved-scene':'current-assets';metrics.recoveryReason=decision.reason;
      if(!decision.reuse){recover=null;console.log('REBUILD_WITH_CURRENT_ASSETS '+decision.reason);}
    }
  }
  if(recover)await run(blender,['--background','--factory-startup','--python-exit-code','1','--python','experiments/3d-sample/recover_saved_scene.py','--','--source-dir',path.resolve(root,recover),'--artifact-dir',out,'--name',name],'recover_scene');
  else {
    const build=['--background','--factory-startup','--python-exit-code','1','--python','experiments/3d-sample/render_sample_v2.py','--','--input-dir',out,'--output-dir',out,'--name',name,'--frame-entities','--build-only','--resolution',options['--resolution']??'3200'];
    if(options['--preview'])build.push('--preview');
    if(options['--legacy-assets'])build.push('--legacy-assets');
    if(options['--asset-library'])build.push('--asset-library',path.resolve(root,options['--asset-library']));
    await run(blender,build,'build_scene');
  }
}
await run(blender,['--background','--factory-startup','--python-exit-code','1','--python','experiments/3d-sample/verify_scene.py','--','--artifact-dir',out,'--blend',path.join(out,name+'.blend')],'verify_scene');
// Make the verified scene reusable even if a later photograph is interrupted.
if(name==='scene'&&!options['--legacy-assets']&&!options['--asset-library'])await writeSignature(out,{sourceHash:metrics.sourceHash,fingerprint,quality,imageFiles:[]});
const views=options['--details']?['full','center',...(selection.buildings.some(b=>b.wardType==='Castle')?['castle']:[])]:[view];
const photograph=['--background','--factory-startup','--python-exit-code','1','--python','experiments/3d-sample/render_views.py','--','--blend',path.join(out,name+'.blend'),'--artifact-dir',out,'--resolution',options['--resolution']??'3200'];
for(const v of views)photograph.push('--view',v);
if(options['--preview'])photograph.push('--preview');
await run(blender,photograph,'render_views');
if(name==='scene'&&!options['--legacy-assets']&&!options['--asset-library'])await writeSignature(out,{sourceHash:metrics.sourceHash,fingerprint,quality,imageFiles:views.map(imageForView)});
metrics.counts=JSON.parse(await fs.readFile(path.join(out,'verification.json'),'utf8')).counts;
metrics.finishedAt=new Date().toISOString();await saveMetrics();
console.log('3D sample complete: '+out);
}
await main();
