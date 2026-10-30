import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
// Keep the built workspace core in Vite's config dependency graph. A package
// import is externalized and stays in Node's ESM cache across server restarts,
// leaving the API on an older schema after the browser picks up a core build.
import { validateTown, serializeTown } from '../../../packages/core/dist/index.js';
import { fingerprints, inspectCache, copyArtifacts, townHash } from './three-d-cache.mjs';
import { failureDiagnostics } from './three-d-diagnostics.mjs';
import { riverSupportError } from '../shared/three-d-support.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const jobsRoot = process.env.SETTLEMENT_3D_JOBS_ROOT ? path.resolve(process.env.SETTLEMENT_3D_JOBS_ROOT) : path.join(root, 'artifacts/web-3d');
const blender = process.env.BLENDER_PATH ?? 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
// Models and structural data stay on the server for rendering and recovery.
const publicImageNames = new Set(['scene-render.png','render-preview.png','city-center-render.png','castle-wall-detail.png']);
const sampleDirs = { 'sample-6': ['3d-minimal-city','minimal-city'], 'sample-12': ['3d-small-town-assets','small-town-assets'], 'sample-12-legacy': ['3d-small-town','small-town'], 'sample-harbor': ['3d-harbor','scene'], 'sample-river': ['3d-river-town','scene'], 'sample-estuary': ['3d-estuary-town','scene'], 'sample-markets': ['3d-multi-market','scene'] };
sampleDirs['sample-river-harbor']=['3d-river-harbor','scene'];
sampleDirs['sample-estuary-river-harbor']=['3d-estuary-river-harbor','scene'];
const digest = town => createHash('sha256').update(serializeTown(town)).digest('hex');
const activeStatus = job => ['running','cancelling'].includes(job.status);
const safeId = id => /^[a-f0-9-]{36}$/.test(id) || Object.hasOwn(sampleDirs, id);

export function threeDPlugin() {
  return { name: 'local-three-d', configureServer(server) { install(server); } };
}

function install(server) {
  const jobs = new Map();
  const writes = new Map();
  let child = null, active = null, starting = false;
  const persist = job => {
    const text=JSON.stringify(job,null,2),file=path.join(jobsRoot,job.id,'job.json');
    const write=(writes.get(job.id)??Promise.resolve()).catch(()=>{}).then(async()=>{await fs.writeFile(file+'.tmp',text);await fs.rename(file+'.tmp',file);});
    writes.set(job.id,write);return write;
  };
  const ready = (async () => {
    await fs.mkdir(jobsRoot, { recursive: true });
    for (const entry of await fs.readdir(jobsRoot)) {
      if (!safeId(entry) || Object.hasOwn(sampleDirs,entry)) continue;
      try {
        const job = JSON.parse(await fs.readFile(path.join(jobsRoot,entry,'job.json'),'utf8'));
        if (job.id !== entry) continue;
        if (activeStatus(job)) { job.status='failed';job.stage='本地服务已重启，请重新生成';await persist(job); }
        if(job.status==='failed')Object.assign(job,await failureDiagnostics(path.join(jobsRoot,entry)));
        jobs.set(entry,job);
      } catch { /* Ignore incomplete job folders. */ }
    }
    for (const [id,[dir,stem]] of Object.entries(sampleDirs)) {
      try {
        const town=JSON.parse(await fs.readFile(path.join(root,'artifacts',dir,'source-town.json'),'utf8'));
        const v=JSON.parse(await fs.readFile(path.join(root,'artifacts',dir,'verification.json'),'utf8'));
        if(v.status!=='pass' || !existsSync(path.join(root,'artifacts',dir,stem+'.blend'))) continue;
        jobs.set(id,{id,status:'complete',stage:v.assetIntegration?.enabled?'已完成 · 结构与素材校验通过':'已完成 · 结构校验通过',quality:id.includes('river-harbor')?'preview':'high',sample:true,
          createdAt:['sample-river','sample-estuary','sample-markets','sample-river-harbor','sample-estuary-river-harbor'].includes(id)?(await fs.stat(path.join(root,'artifacts',dir,stem+'.blend'))).mtime.toISOString():'2026-10-24T00:00:00Z',seed:town.resolved.seed,size:town.resolved.size,buildings:town.buildings.length,sourceHash:digest(town)});
      } catch { /* An existing sample is optional. */ }
    }
  })();
  function filesFor(job) {
    const sample=sampleDirs[job.id];
    const dir=sample?path.join(root,'artifacts',sample[0]):path.join(jobsRoot,job.id);
    return {dir,resolve(name) { return path.join(dir,sample ? name.replace(/^scene(?=\.|-render)/,sample[1]) : name); }};
  }
  function publicJob(job) {
    const files=filesFor(job), available={};
    for(const name of publicImageNames)if(job.status==='complete'&&existsSync(files.resolve(name)))available[name]=`/api/3d/jobs/${job.id}/files/${name}`;
    const canRecover=!job.sample&&['failed','cancelled'].includes(job.status)&&existsSync(files.resolve('scene.blend'))&&existsSync(files.resolve('scene-manifest.json'));
    return {...job,canRecover,assetLibraryUsed:job.status==='complete'&&existsSync(files.resolve('asset-integration.json')),files:available};
  }
  async function stop() {
    if(!child?.pid || !active) return;
    const job=jobs.get(active);job.status='cancelling';job.stage='正在取消';await persist(job);
    await fs.writeFile(path.join(jobsRoot,job.id,'cancel.request'),'cancel');
  }
  server.httpServer?.once('close',()=>{void stop();});
  function launch(job) {
    active=job.id;
    const dir=path.join(jobsRoot,job.id);
    const args=['scripts/generate-3d-sample.mjs','--skip-build','--input',path.join(dir,'input.json'),'--output',dir,'--name','scene','--blender',blender,'--resolution','3200'];
    args.push('--view',job.requestedView??'center');
    if(job.quality==='preview') args.push('--preview');
    if(job.recoveredFrom)args.push('--recover-scene',path.join(jobsRoot,job.recoveredFrom));
    if(job.reusedSceneFrom)args.push('--reuse-scene',path.join(jobsRoot,job.reusedSceneFrom));
    const proc=spawn(process.execPath,args,{cwd:root,env:{...process.env,SETTLEMENT_CANCEL_FILE:path.join(dir,'cancel.request')},windowsHide:true,stdio:['ignore','pipe','pipe']});
    child=proc;
    let tail='', finished=false, writeQueue=Promise.resolve();
    const consume=chunk=>{
      const text=chunk.toString();tail=(tail+text).slice(-5000);
      writeQueue=writeQueue.then(()=>fs.appendFile(path.join(dir,'pipeline.log'),text)).catch(()=>{});
      if(job.status!=='running') return;
      const before=job.stage;
      if(text.includes('render_sample_v2.py')) job.stage='正在拼装三维场景';
      if(text.includes('recover_saved_scene.py')) job.stage='正在修复已保存的三维场景';
      if(text.includes('render_saved_scene.py')) job.stage='正在渲染已校验场景';
      if(text.includes('render_views.py')) job.stage='正在渲染所选取景';
      if(text.includes('"name":"copy_scene"')) job.stage='已复用校验场景';
      if(text.includes('BUILD_STAGE native_buildings '))job.stage='正在装配建筑素材';
      if(text.includes('BUILD_STAGE authored_architecture '))job.stage='正在生成城墙和公共设施';
      if(text.includes('BUILD_STAGE market '))job.stage='正在生成植被和公共设施';
      if(text.includes('BUILD_STAGE planning_features '))job.stage='正在布置沿街店面';
      if(text.includes('BUILD_STAGE harbor '))job.stage='已装配港区、码头和船只，正在准备淡彩材质';
      if(text.includes('BUILD_STAGE river '))job.stage='已生成河道、两岸与石拱桥，正在装配道路和城防';
      if(text.includes('BUILD_STAGE estuary_geometry '))job.stage='正在连接河海水面与两岸地形';
      if(text.includes('REBUILD_WITH_CURRENT_ASSETS '))job.stage='素材已更新，正在按原规划重新装配';
      if(text.includes('Rendering ')) job.stage='正在渲染线稿淡彩图';
      if(text.includes('verify_scene.py')) job.stage='正在校验规划结构';
      if(text.includes('render_city_detail.py')) job.stage='正在渲染城内放大图';
      if(text.includes('render_integrated_details.py')) job.stage='正在渲染城堡局部图';
      if(before!==job.stage) void persist(job);
    };
    proc.stdout.on('data',consume);proc.stderr.on('data',consume);
    async function finish(code,message) {
      if(finished)return;finished=true;
      if(job.status==='cancelling') {job.status='cancelled';job.stage='已取消，可重新生成';}
      else if(code===0) {
        try {
          const v=JSON.parse(await fs.readFile(path.join(dir,'verification.json'),'utf8'));
          if(v.status!=='pass') throw new Error('结构校验未通过');
          job.status='complete';job.stage=v.assetIntegration?.enabled?'已完成 · 结构与素材校验通过':'已完成 · 结构校验通过';job.verifiedBuildings=v.counts.verifiedBuildings;
        } catch {job.status='failed';job.stage='未找到通过的结构校验结果，请重试';}
      } else {
        job.status='failed';job.stage='生成失败，请重试';job.error=(message??tail).slice(-2200);
        Object.assign(job,await failureDiagnostics(dir));
        if(job.failedStage==='verify_scene')job.stage='结构校验未通过';
      }
      job.finishedAt=new Date().toISOString();await writeQueue;await persist(job);
      if(active===job.id){active=null;child=null;}
    }
    proc.once('error',err=>void finish(-1,err.message));proc.once('close',code=>void finish(code));
  }
  async function createJob(town,quality,view='center') {
    if(!['preview','high'].includes(quality))throw new Error('请选择预览或高清模式');
    if(!['center','full','castle'].includes(view))throw new Error('请选择有效取景');
    if(view==='castle'&&!town.resolved.castle)throw new Error('该规划没有城堡');
    const started=performance.now(),sourceHash=townHash(town),fingerprint=await fingerprints(root);
    let reusable=null;
    // Prefer a finished photograph, then a verified scene. Failed photographs
    // can still supply their independently verified, unchanged scene bytes.
    for(const previous of [...jobs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))) {
      if(previous.sample||activeStatus(previous)||previous.sourceHash!==sourceHash)continue;
      const cache=await inspectCache(path.join(jobsRoot,previous.id),{sourceHash,fingerprint,quality,view});
      if(!cache)continue;
      if(!reusable)reusable={...cache,id:previous.id};
      if(cache.result&&previous.status==='complete'){reusable={...cache,id:previous.id};break;}
    }
    const id=randomUUID(),dir=path.join(jobsRoot,id);await fs.mkdir(dir);
    await fs.writeFile(path.join(dir,'input.json'),serializeTown(town));
    const job={id,status:'running',stage:'正在读取当前平面规划',quality,requestedView:view,hasCastle:town.resolved.castle,
      createdAt:new Date().toISOString(),seed:town.resolved.seed,size:town.resolved.size,buildings:town.buildings.length,sourceHash};
    if(reusable?.result) {
      await copyArtifacts(reusable.dir,dir,{images:true,view});
      if(!(await inspectCache(dir,{sourceHash,fingerprint,quality,view}))?.result)throw new Error('缓存文件发生变化，请重新生成');
      const verification=JSON.parse(await fs.readFile(path.join(dir,'verification.json'),'utf8'));
      job.status='complete';job.stage='已完成 · 复用相同规划的已校验结果';job.cacheHit='result';job.reusedResultFrom=reusable.id;
      job.finishedAt=new Date().toISOString();job.verifiedBuildings=verification.counts.verifiedBuildings;
      await fs.writeFile(path.join(dir,'pipeline-performance.json'),JSON.stringify({version:1,cacheHit:'result',reusedFrom:reusable.id,
        seconds:(performance.now()-started)/1000,quality,requestedView:view,counts:verification.counts,phases:[{name:'validate_and_copy_cached_result',status:'complete',seconds:(performance.now()-started)/1000}]},null,2));
      jobs.set(id,job);await persist(job);return publicJob(job);
    }
    if(reusable){job.reusedSceneFrom=reusable.id;job.cacheHit='scene';job.stage='正在复用相同规划的校验场景';}
    jobs.set(id,job);await persist(job);launch(job);return publicJob(job);
  }
  server.middlewares.use(async (req,res,next)=>{
    const url=new URL(req.url??'/', 'http://localhost');
    if(!url.pathname.startsWith('/api/3d/'))return next();
    const json=(code,value)=>{res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));};
    // Local process execution is exposed only to this loopback page, never a
    // cross-origin form or a DNS-rebound host. Client paths are not accepted.
    const host=req.headers.host??'';
    if(!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host))return json(403,{error:'仅允许本机访问'});
    if(req.method==='POST' && (req.headers.origin!==`http://${host}` || !req.headers['content-type']?.startsWith('application/json')))return json(403,{error:'请从本地网页发起操作'});
    try {
      await ready;
      if(req.method==='GET' && url.pathname==='/api/3d/status')return json(200,{available:existsSync(blender),activeId:active,jobs:[...jobs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(publicJob)});
      if(req.method==='POST' && url.pathname==='/api/3d/jobs') {
        if(active || starting)return json(409,{error:'已有三维任务正在运行，请等待完成或取消它'});
        if(!existsSync(blender))return json(503,{error:'未找到 Blender，请设置本地 BLENDER_PATH 后重启服务'});
        starting=true;
        try {
          let length=0;const chunks=[];
          for await(const chunk of req){length+=chunk.length;if(length>8_000_000){json(413,{error:'规划数据超过 8 MB'});return;}chunks.push(chunk);}
          const body=JSON.parse(Buffer.concat(chunks).toString());
          validateTown(body.town);const town=body.town;
          if(!['preview','high'].includes(body.quality))return json(400,{error:'请选择预览或高清模式'});
          const riverError=riverSupportError(town);if(riverError)return json(422,{error:riverError});
          if(town.features.some(f=>!['grove','statue','fountain'].includes(f.kind)))return json(422,{error:'地图包含尚未适配的规划要素'});
          return json(202,await createJob(town,body.quality,body.view??'center'));
        } finally {starting=false;}
      }
      const match=url.pathname.match(/^\/api\/3d\/jobs\/([^/]+)(?:\/(cancel|files|retry|render)(?:\/([^/]+))?)?$/);
      if(!match || !safeId(match[1]) || !jobs.has(match[1]))return json(404,{error:'任务不存在'});
      const job=jobs.get(match[1]);
      if(req.method==='POST'&&match[2]==='render') {
        if(active||starting)return json(409,{error:'已有三维任务正在运行，请等待完成或取消它'});
        if(job.sample||job.status!=='complete')return json(400,{error:'请选择已完成的本地场景'});
        starting=true;
        try {
          let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;if(length>1024)return json(413,{error:'请求过大'});chunks.push(chunk);}
          const body=JSON.parse(Buffer.concat(chunks).toString()),town=JSON.parse(await fs.readFile(path.join(jobsRoot,job.id,'input.json'),'utf8'));validateTown(town);
          return json(202,await createJob(town,job.quality,body.view));
        }finally{starting=false;}
      }
      if(req.method==='POST' && match[2]==='retry') {
        if(active || starting)return json(409,{error:'已有三维任务正在运行，请等待完成或取消它'});
        if(!['failed','cancelled'].includes(job.status)||job.sample)return json(400,{error:'仅可恢复未完成的本地任务'});
        const previous=path.join(jobsRoot,job.id);
        if(!existsSync(path.join(previous,'scene.blend'))||!existsSync(path.join(previous,'scene-manifest.json')))return json(422,{error:'该任务尚未保存场景，请重新生成'});
        starting=true;
        try {
          const town=JSON.parse(await fs.readFile(path.join(previous,'input.json'),'utf8'));validateTown(town);
          const id=randomUUID(),dir=path.join(jobsRoot,id);await fs.mkdir(dir);
          await fs.writeFile(path.join(dir,'input.json'),serializeTown(town));
          const recovered={id,status:'running',stage:'正在恢复已保存场景',quality:job.quality,createdAt:new Date().toISOString(),
            seed:town.resolved.seed,size:town.resolved.size,buildings:town.buildings.length,sourceHash:digest(town),recoveredFrom:job.id};
          jobs.set(id,recovered);await persist(recovered);launch(recovered);return json(202,publicJob(recovered));
        } finally {starting=false;}
      }
      if(req.method==='GET' && !match[2])return json(200,publicJob(job));
      if(req.method==='POST' && match[2]==='cancel') {if(active===job.id)await stop();return json(200,publicJob(job));}
      if(req.method==='GET' && match[2]==='files') {
        if(!publicImageNames.has(match[3])||job.status!=='complete')return json(404,{error:'图片不存在'});
        const name=match[3],file=filesFor(job).resolve(name);
        if(!existsSync(file))return json(404,{error:'文件不存在'});
        res.setHeader('Content-Type','image/png');
        if(url.searchParams.has('download'))res.setHeader('Content-Disposition',`attachment; filename="${name}"`);
        res.setHeader('X-Content-Type-Options','nosniff');
        const stream=createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);return;
      }
      return json(405,{error:'不支持此操作'});
    } catch(err) {if(!res.headersSent)json(400,{error:err instanceof Error?err.message:'无法读取请求'});}
  });
}
