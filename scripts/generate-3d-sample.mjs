import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// End-to-end adapter around the existing flat planner and the editable Blender
// kit. No image tracing, independent city generation, or core algorithm changes.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valued = new Set(['--input','--output','--seed','--size','--blender','--resolution','--name','--asset-library']);
const flags = new Set(['--preview','--skip-build','--help','--legacy-assets']);
const options = {};
for (let i=0;i<args.length;i++) {
  const arg=args[i];
  if (flags.has(arg)) options[arg]=true;
  else if (valued.has(arg) && args[i+1] && !args[i+1].startsWith('--')) options[arg]=args[++i];
  else throw new Error(`Unknown option or missing value: ${arg}`);
}
if (options['--help']) {
  console.log('npm run sample:3d -- [--input town.json] [--output artifacts/3d-minimal-city] [--name minimal-city] [--seed 7] [--size 6] [--preview] [--resolution 3200] [--blender path] [--skip-build] [--asset-library library.blend] [--legacy-assets]');
  process.exit(0);
}
const out=path.resolve(root,options['--output'] ?? 'artifacts/3d-minimal-city');
const name=options['--name'] ?? 'minimal-city';
if(!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) throw new Error('--name must be a simple filename stem.');
const blender=options['--blender'] ?? process.env.BLENDER_PATH ?? (process.platform==='win32' ? 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' : 'blender');
const env={...process.env,OPTIX_CACHE_PATH:process.env.OPTIX_CACHE_PATH ?? path.join(root,'.cache/optix')};
await fs.mkdir(env.OPTIX_CACHE_PATH,{recursive:true});
const cancelled=()=>Boolean(process.env.SETTLEMENT_CANCEL_FILE && existsSync(process.env.SETTLEMENT_CANCEL_FILE));
async function run(command,argv) {
  if(cancelled()) throw new Error('Generation cancelled');
  console.log(`\n${path.basename(command)} ${argv.join(' ')}`);
  await new Promise((resolve,reject)=>{
    const child=spawn(command,argv,{cwd:root,env,stdio:'inherit',windowsHide:true});
    // The pipeline owns the Blender process handle. Stop that exact child,
    // without querying/killing unrelated Blender sessions or using taskkill.
    // Let the short browser export finish so Playwright closes its own Chrome.
    const timer=command===blender && process.env.SETTLEMENT_CANCEL_FILE ? setInterval(()=>{if(cancelled())child.kill();},400) : null;
    const clear=()=>{if(timer)clearInterval(timer);};
    child.on('error',err=>{clear();reject(err);});
    child.on('exit',code=>{clear();cancelled()?reject(new Error('Generation cancelled')):code===0?resolve():reject(new Error(`${command} exited ${code}`));});
  });
}
if (!options['--skip-build']) {
  // Under npm, use its actual JS entry rather than a Windows .cmd shell shim.
  if (!process.env.npm_execpath) throw new Error('Run via npm run sample:3d, or supply --skip-build after npm run build:packages.');
  await run(process.execPath,[process.env.npm_execpath,'run','build:packages']);
}
const adapter=['experiments/3d-sample/export-minimal-town.mjs','--output',out];
for(const key of ['--input','--seed','--size']) if(options[key]) adapter.push(key,options[key]);
await run(process.execPath,adapter);
const selection=JSON.parse(await fs.readFile(path.join(out,'selection.json'),'utf8'));
const unsupportedFeatures=selection.features.filter(f=>!['grove','statue','fountain'].includes(f.kind));
const source=JSON.parse(await fs.readFile(path.join(out,'source-town.json'),'utf8'));
if (unsupportedFeatures.length || source.river || source.terrain?.coast || source.terrain?.docks?.length) {
  throw new Error('This 3D adapter supports dry-land plans with grove/statue/fountain features. Water or unknown feature modules still need implementation; the exported 2D plan is retained.');
}
if ((selection.plazas?.length ?? 0)>1) throw new Error('This first 3D adapter supports at most one market square.');
const render=['--background','--factory-startup','--python-exit-code','1','--python','experiments/3d-sample/render_sample_v2.py','--',
  '--input-dir',out,'--output-dir',out,'--name',name,'--frame-entities','--resolution',options['--resolution'] ?? '3200'];
if(options['--preview']) render.push('--preview');
if(options['--legacy-assets']) render.push('--legacy-assets');
if(options['--asset-library']) render.push('--asset-library',path.resolve(root,options['--asset-library']));
await run(blender,render);
await run(blender,['--background','--factory-startup','--python-exit-code','1','--python','experiments/3d-sample/verify_scene.py','--',
  '--artifact-dir',out,'--blend',path.join(out,name+'.blend')]);
if(!options['--preview']) await run(blender,['--background','--factory-startup','--python-exit-code','1','--python','experiments/3d-sample/render_city_detail.py','--','--artifact-dir',out,'--name',name,'--resolution',options['--resolution'] ?? '2800']);
console.log(`\n3D sample complete: ${out}`);
