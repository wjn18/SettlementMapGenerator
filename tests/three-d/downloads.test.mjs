import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'vite';
import { assertImageOnlyDownloads } from './local-artifacts.mjs';

test('3D history and file routes expose render images while keeping models and reports private',async()=>{
  const root=path.resolve('.cache');await fs.mkdir(root,{recursive:true});
  const jobsRoot=await fs.mkdtemp(path.join(root,'three-d-downloads-'));
  const previous=process.env.SETTLEMENT_3D_JOBS_ROOT;
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XnIoAAAAASUVORK5CYII=','base64');
  const ids={};let server;
  try {
    for(const status of ['complete','failed','cancelled']) {
      const id=randomUUID();ids[status]=id;const dir=path.join(jobsRoot,id);await fs.mkdir(dir);
      await fs.writeFile(path.join(dir,'job.json'),JSON.stringify({id,status,quality:'preview',createdAt:new Date().toISOString()}));
      for(const name of ['scene.blend','source-town.json','scene-manifest.json','verification.json','asset-integration.json','pipeline-performance.json','planning.svg','planning.png']) {
        await fs.writeFile(path.join(dir,name),name.endsWith('.json')?'{}':'private backend artifact');
      }
      await fs.writeFile(path.join(dir,'city-center-render.png'),image);
    }
    process.env.SETTLEMENT_3D_JOBS_ROOT=jobsRoot;
    server=await createServer({root:path.resolve('apps/playground'),configFile:path.resolve('apps/playground/vite.config.ts'),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
    await server.listen();const base=`http://127.0.0.1:${server.httpServer.address().port}`;
    const state=await(await fetch(base+'/api/3d/status')).json();
    for(const [status,id] of Object.entries(ids)) {
      const listed=state.jobs.find(job=>job.id===id);
      const job=await(await fetch(base+'/api/3d/jobs/'+id)).json();
      assert.deepEqual(job.files,listed.files);await assertImageOnlyDownloads(base,job);
      for(const name of ['planning.svg','planning.png','scene.blend','%73cene.blend']) {
        const response=await fetch(`${base}/api/3d/jobs/${id}/files/${name}`);
        assert.equal(response.status,404);await response.body.cancel();
      }
      const url=`${base}/api/3d/jobs/${id}/files/city-center-render.png`;
      for(const name of ['scene.blend','source-town.json','verification.json']) {
        const file=path.join(jobsRoot,id,name).replaceAll('\\','/');
        const direct=await fetch(`${base}/@fs/${file}?raw`);
        assert.equal(direct.status,403,`Vite must not bypass the 3D file rules for ${name}`);
        assert(!(await direct.text()).includes('private backend artifact'));
      }
      if(status!=='complete') {
        assert.deepEqual(job.files,{});assert.equal(job.canRecover,true);
        const response=await fetch(url);assert.equal(response.status,404);await response.body.cancel();continue;
      }
      assert.equal(job.assetLibraryUsed,true);
      assert.deepEqual(Object.keys(job.files),['city-center-render.png']);
      const preview=await fetch(url);assert.equal(preview.status,200);assert.equal(preview.headers.get('content-type'),'image/png');
      assert.equal(preview.headers.get('content-disposition'),null);assert.deepEqual(Buffer.from(await preview.arrayBuffer()),image);
      const download=await fetch(url+'?download=1');assert.equal(download.status,200);
      assert.match(download.headers.get('content-disposition'),/attachment; filename="city-center-render.png"/);
      assert.deepEqual(Buffer.from(await download.arrayBuffer()),image);
    }
  } finally {
    await server?.close();
    if(previous===undefined)delete process.env.SETTLEMENT_3D_JOBS_ROOT;else process.env.SETTLEMENT_3D_JOBS_ROOT=previous;
    assert(jobsRoot.startsWith(root+path.sep));await fs.rm(jobsRoot,{recursive:true,force:true});
  }
});
