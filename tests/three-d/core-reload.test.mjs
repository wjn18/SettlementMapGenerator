import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';

test('the running 3D API reloads a rebuilt core validator, including cached transitive modules', {timeout:30_000}, async()=>{
  const root=path.resolve('.cache');await fs.mkdir(root,{recursive:true});
  const fixture=await fs.mkdtemp(path.join(root,'three-d-core-reload-'));
  const previousJobs=process.env.SETTLEMENT_3D_JOBS_ROOT,previousBlender=process.env.BLENDER_PATH;
  let server;
  try {
    const app=path.join(fixture,'apps/playground'),core=path.join(fixture,'packages/core/dist');
    await fs.cp('packages/core/dist',core,{recursive:true});
    await fs.cp('apps/playground/server',path.join(app,'server'),{recursive:true});
    await fs.cp('apps/playground/shared',path.join(app,'shared'),{recursive:true});
    await fs.copyFile('apps/playground/vite.config.ts',path.join(app,'vite.config.ts'));
    await fs.writeFile(path.join(fixture,'package.json'),'{"type":"module"}');
    const file=path.join(core,'serialization.js'),source=await fs.readFile(file,'utf8');
    const version=n=>source.replace('export function validateTown(value) {',`export function validateTown(value) { if (value?.reloadProbe) throw new Error('core-validator-${n}');`);
    assert.notEqual(version(1),source);
    await fs.writeFile(file,version(1));
    // Simulate a core already loaded by the long-lived Node process. Vite must
    // reload the validator below even though this ESM instance stays cached.
    const cached=await import(pathToFileURL(path.join(core,'index.js')).href);
    assert.throws(()=>cached.validateTown({reloadProbe:true}),/core-validator-1/);
    process.env.SETTLEMENT_3D_JOBS_ROOT=path.join(fixture,'jobs');
    process.env.BLENDER_PATH=process.execPath; // Exists, but the probe never starts a process.
    server=await createServer({root:app,configFile:path.join(app,'vite.config.ts'),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
    await server.listen();
    const base=()=>`http://127.0.0.1:${server.httpServer.address().port}`;
    const probe=async()=>{
      const origin=base();const response=await fetch(origin+'/api/3d/jobs',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({town:{reloadProbe:true},quality:'preview'})});
      assert.equal(response.status,400);return (await response.json()).error;
    };
    assert.equal(await probe(),'core-validator-1');
    await fs.writeFile(file,version(2));
    let actual;
    const deadline=Date.now()+15_000;
    while(Date.now()<deadline){
      try {actual=await probe();if(actual==='core-validator-2')break;}catch{/* Restart can briefly close the socket. */}
      await delay(100);
    }
    assert.equal(actual,'core-validator-2','core rebuild must update the API without restarting Node');
    assert.throws(()=>cached.validateTown({reloadProbe:true}),/core-validator-1/,'the old Node ESM instance remains stale');
    assert.deepEqual((await (await fetch(base()+'/api/3d/status')).json()).jobs,[]);
  } finally {
    await server?.close();
    if(previousJobs===undefined)delete process.env.SETTLEMENT_3D_JOBS_ROOT;else process.env.SETTLEMENT_3D_JOBS_ROOT=previousJobs;
    if(previousBlender===undefined)delete process.env.BLENDER_PATH;else process.env.BLENDER_PATH=previousBlender;
    assert(fixture.startsWith(root+path.sep));await fs.rm(fixture,{recursive:true,force:true});
  }
});
