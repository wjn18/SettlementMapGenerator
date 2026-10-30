// Browser -> current coastal river plan -> local API -> validated scene/download.
// --reuse-sample seeds an isolated job history from the already verified CLI
// sample and proves real cache reuse without starting another Blender render.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { serializeTown } from '@settlement/core';
import { townHash, copyArtifacts, fingerprints, inspectCache } from '../../apps/playground/server/three-d-cache.mjs';

const args=process.argv.slice(2);
const value=(name,fallback)=>{const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error('Missing value for '+name);return args[i+1];};
const reuse=args.includes('--reuse-sample');
let base=value('--base',process.env.THREE_D_TEST_BASE);
const port=Number(value('--port',process.env.THREE_D_TEST_PORT??'5175'));
assert.ok(Number.isInteger(port)&&port>0&&port<=65535,'--port must be an integer from 1 to 65535.');
const input=path.resolve(value('--input','artifacts/3d-estuary-town/source-town.json'));
const sampleDir=path.dirname(input);
const out=path.resolve(value('--output',process.env.THREE_D_TEST_OUTPUT??'artifacts/estuary-web-test'));
await fs.mkdir(out,{recursive:true});
const original=JSON.parse(await fs.readFile(input,'utf8'));
assert.ok(original.river?.surface?.length>=3,'The input must retain its actual river surface.');
assert.ok(original.terrain?.coast?.water?.length>=3,'The input must retain its actual coastal water.');
assert.ok(original.river.bridges.length>0,'The saved plan must contain a crossing.');
let server=null,seedId=null,quality='preview';
if(reuse)assert.ok(!base,'--reuse-sample requires the isolated server so it cannot alter another job history.');
if(!base){
  process.env.SETTLEMENT_3D_JOBS_ROOT=path.join(out,'jobs-'+randomUUID());
  await fs.mkdir(process.env.SETTLEMENT_3D_JOBS_ROOT,{recursive:true});
  if(reuse){
    const report=JSON.parse(await fs.readFile(path.join(sampleDir,'verification.json'),'utf8'));
    const signature=JSON.parse(await fs.readFile(path.join(sampleDir,'cache-signature.json'),'utf8'));
    assert.equal(report.status,'pass');assert.equal(report.river.passed,true);assert.equal(report.harbor.passed,true);assert.equal(report.estuary.passed,true);
    quality=signature.quality;
    assert.ok(['preview','high'].includes(quality));
    const cache=await inspectCache(sampleDir,{sourceHash:townHash(original),fingerprint:await fingerprints(path.resolve('.')),quality,view:'center'});
    assert.ok(cache?.result,'The sample cache is missing, stale or has no matching center image; regenerate the sample before running --reuse-sample.');
    seedId=randomUUID();const seedDir=path.join(process.env.SETTLEMENT_3D_JOBS_ROOT,seedId);
    await fs.mkdir(seedDir);
    await copyArtifacts(sampleDir,seedDir,{images:true,view:'center'});
    await fs.writeFile(path.join(seedDir,'job.json'),JSON.stringify({id:seedId,status:'complete',stage:'Verified estuary sample',
      quality,requestedView:'center',createdAt:new Date().toISOString(),finishedAt:new Date().toISOString(),
      seed:original.resolved.seed,size:original.resolved.size,buildings:original.buildings.length,
      sourceHash:townHash(original),hasCastle:original.resolved.castle},null,2));
  }
  const {createServer}=await import('vite');
  server=await createServer({root:path.resolve('apps/playground'),configFile:path.resolve('apps/playground/vite.config.ts'),
    server:{host:'127.0.0.1',port,strictPort:true},logLevel:'error'});
  await server.listen();
  const address=server.httpServer.address();assert.ok(address&&typeof address==='object');
  base='http://127.0.0.1:'+address.port;
}
base=base.replace(/\/$/,'');
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1500,height:1050}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const get=async url=>{const response=await fetch(base+url);assert.equal(response.status,200,url);return response.json();};
try{
  await page.goto(base+'/?test=1');await page.waitForSelector('body[data-ready="true"]');
  await page.evaluate(text=>window.__playground.load(text),serializeTown(original));
  await page.waitForFunction(()=>!document.querySelector('#three-d-generate').disabled,null,{timeout:120000});
  assert.equal(await page.locator('#river').inputValue(),'true');
  assert.equal(await page.locator('#coast').inputValue(),String(original.request.coast??original.terrain.coast.side));
  assert.equal(await page.locator('#harbor').inputValue(),String(original.request.harbor??true));
  await page.selectOption('#three-d-quality',quality);
  const posted=page.waitForResponse(r=>r.url().endsWith('/api/3d/jobs')&&r.request().method()==='POST');
  await page.locator('#three-d-generate').click();
  const response=await posted;assert.equal(response.status(),202);const submitted=await response.json();
  console.log('ESTUARY_WEB_STARTED',submitted.id,reuse?'cached sample':'generation');
  let finished;
  for(let n=0;n<450;n++){
    finished=await get('/api/3d/jobs/'+submitted.id);
    if(!['running','cancelling'].includes(finished.status))break;
    if(n%15===0)console.log('ESTUARY_WEB_PROGRESS',finished.stage);
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  assert.equal(finished.status,'complete',JSON.stringify(finished));
  if(reuse){assert.equal(finished.cacheHit,'result');assert.equal(finished.reusedResultFrom,seedId);}
  const report=await get(finished.files['verification.json']);
  assert.equal(report.status,'pass');assert.equal(report.river.passed,true);assert.equal(report.harbor.passed,true);assert.equal(report.estuary.passed,true);
  assert.equal(report.counts.verifiedBuildings,original.buildings.length);
  const source=await get(finished.files['source-town.json']);assert.deepEqual(source,original);
  const imagePath=finished.files['city-center-render.png'];assert.ok(imagePath,'The completed job must expose its center image.');
  await page.waitForFunction(image=>{const el=document.querySelector('#three-d-image');return !el.hidden&&el.complete&&el.naturalWidth>0&&el.src.includes(image);},imagePath,{timeout:30000});
  const image=await fetch(base+imagePath);assert.equal(image.status,200);
  const imageBytes=Buffer.from(await image.arrayBuffer());assert.ok(imageBytes.length>10000);assert.equal(imageBytes.subarray(1,4).toString(),'PNG');
  const expectedWidth=quality==='preview'?1500:3200;assert.equal(imageBytes.readUInt32BE(16),expectedWidth);assert.equal(imageBytes.readUInt32BE(20),expectedWidth);
  const blend=await fetch(base+finished.files['scene.blend']+'?download=1');assert.equal(blend.status,200);
  assert.match(blend.headers.get('content-disposition')??'',/attachment/);assert.ok((await blend.arrayBuffer()).byteLength>100000);
  await page.screenshot({path:path.join(out,'estuary-city.png')});
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(out,'web-verification.json'),JSON.stringify({passed:true,jobId:finished.id,seedId,cacheHit:finished.cacheHit,quality,imageWidth:expectedWidth,
    sourceHash:townHash(original),coastSide:original.terrain.coast.side,harbor:original.request.harbor??true,estuary:report.estuary,river:report.river,harborVerification:report.harbor,checks:['import saved coastal river plan','coast and harbor controls retain the saved request','estuary button enabled','browser POST returns 202',
      reuse?'verified result cache reused':'real Blender generation','saved combined-water, river and coastal structure verification','exact submitted source',
      'center image visible and downloadable','Blender scene download'],pageErrors:errors},null,2));
  console.log('PASS estuary web workflow',finished.id);
}finally{await browser.close();if(server)await server.close();}
