import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateTown, serializeTown } from '@settlement/core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const jobsRoot = path.join(root, 'artifacts/web-3d');
const blender = process.env.BLENDER_PATH ?? 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const fileNames = new Set(['scene.blend','scene-render.png','render-preview.png','city-center-render.png','planning.png','planning.svg','source-town.json','verification.json','scene-manifest.json','asset-integration.json']);
const sampleDirs = { 'sample-6': ['3d-minimal-city','minimal-city'], 'sample-12': ['3d-small-town-assets','small-town-assets'], 'sample-12-legacy': ['3d-small-town','small-town'] };
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
        jobs.set(entry,job);
      } catch { /* Ignore incomplete job folders. */ }
    }
    for (const [id,[dir,stem]] of Object.entries(sampleDirs)) {
      try {
        const town=JSON.parse(await fs.readFile(path.join(root,'artifacts',dir,'source-town.json'),'utf8'));
        const v=JSON.parse(await fs.readFile(path.join(root,'artifacts',dir,'verification.json'),'utf8'));
        if(v.status!=='pass' || !existsSync(path.join(root,'artifacts',dir,stem+'.blend'))) continue;
        jobs.set(id,{id,status:'complete',stage:v.assetIntegration?.enabled?'已完成 · 结构与素材校验通过':'已完成 · 结构校验通过',quality:'high',sample:true,
          createdAt:'2026-10-24T00:00:00Z',seed:town.resolved.seed,size:town.resolved.size,buildings:town.buildings.length,sourceHash:digest(town)});
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
    if(job.status==='complete') for(const name of fileNames) if(existsSync(files.resolve(name))) available[name]=`/api/3d/jobs/${job.id}/files/${name}`;
    return {...job,assetLibraryUsed:Boolean(available['asset-integration.json']),files:available};
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
    if(job.quality==='preview') args.push('--preview');
    const proc=spawn(process.execPath,args,{cwd:root,env:{...process.env,SETTLEMENT_CANCEL_FILE:path.join(dir,'cancel.request')},windowsHide:true,stdio:['ignore','pipe','pipe']});
    child=proc;
    let tail='', finished=false, writeQueue=Promise.resolve();
    const consume=chunk=>{
      const text=chunk.toString();tail=(tail+text).slice(-5000);
      writeQueue=writeQueue.then(()=>fs.appendFile(path.join(dir,'pipeline.log'),text)).catch(()=>{});
      if(job.status!=='running') return;
      const before=job.stage;
      if(text.includes('render_sample_v2.py')) job.stage='正在拼装三维场景';
      if(text.includes('Rendering ')) job.stage='正在渲染线稿淡彩图';
      if(text.includes('verify_scene.py')) job.stage='正在校验规划结构';
      if(text.includes('render_city_detail.py')) job.stage='正在渲染城内放大图';
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
      } else {job.status='failed';job.stage='生成失败，请重试';job.error=(message??tail).slice(-2200);}
      job.finishedAt=new Date().toISOString();await writeQueue;await persist(job);
      if(active===job.id){active=null;child=null;}
    }
    proc.once('error',err=>void finish(-1,err.message));proc.once('close',code=>void finish(code));
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
          if(town.river || town.terrain?.coast || town.terrain?.docks?.length)return json(422,{error:'当前三维暂不支持河流、海岸和码头，请先生成内陆地图'});
          if(town.districts.filter(d=>d.wardType==='Market').length>1)return json(422,{error:'当前三维仅支持单个市场广场'});
          if(town.features.some(f=>!['grove','statue','fountain'].includes(f.kind)))return json(422,{error:'地图包含尚未适配的规划要素'});
          const id=randomUUID(),dir=path.join(jobsRoot,id);await fs.mkdir(dir);
          await fs.writeFile(path.join(dir,'input.json'),serializeTown(town));
          const job={id,status:'running',stage:'正在读取当前平面规划',quality:body.quality,createdAt:new Date().toISOString(),seed:town.resolved.seed,size:town.resolved.size,buildings:town.buildings.length,sourceHash:digest(town)};
          jobs.set(id,job);await persist(job);launch(job);return json(202,publicJob(job));
        } finally {starting=false;}
      }
      const match=url.pathname.match(/^\/api\/3d\/jobs\/([^/]+)(?:\/(cancel|files)(?:\/([^/]+))?)?$/);
      if(!match || !safeId(match[1]) || !jobs.has(match[1]))return json(404,{error:'任务不存在'});
      const job=jobs.get(match[1]);
      if(req.method==='GET' && !match[2])return json(200,publicJob(job));
      if(req.method==='POST' && match[2]==='cancel') {if(active===job.id)await stop();return json(200,publicJob(job));}
      if(req.method==='GET' && match[2]==='files' && fileNames.has(match[3]) && job.status==='complete') {
        const name=match[3],file=filesFor(job).resolve(name);
        if(!existsSync(file))return json(404,{error:'文件不存在'});
        res.setHeader('Content-Type',name.endsWith('.png')?'image/png':name.endsWith('.svg')?'image/svg+xml':name.endsWith('.json')?'application/json':'application/octet-stream');
        if(url.searchParams.has('download') || name.endsWith('.blend'))res.setHeader('Content-Disposition',`attachment; filename="${name}"`);
        res.setHeader('X-Content-Type-Options','nosniff');
        const stream=createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);return;
      }
      return json(405,{error:'不支持此操作'});
    } catch(err) {if(!res.headersSent)json(400,{error:err instanceof Error?err.message:'无法读取请求'});}
  });
}
