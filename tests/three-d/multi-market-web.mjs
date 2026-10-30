// Browser -> imported multi-market plan -> independently verified scene/cache.
// --reuse-sample uses an isolated server/history and never silently rerenders.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { localJobJson, assertImageOnlyDownloads } from './local-artifacts.mjs';
import { serializeTown, validateTown } from '@settlement/core';
import { townHash, copyArtifacts, fingerprints, inspectCache } from '../../apps/playground/server/three-d-cache.mjs';

const args=process.argv.slice(2),value=(name,fallback)=>{const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing value for '+name);return args[i+1];};
const reuse=args.includes('--reuse-sample'),requireStalls=args.includes('--require-stalls'),input=path.resolve(value('--input','artifacts/3d-multi-market/source-town.json'));
const out=path.resolve(value('--output','artifacts/multi-market-web-test')),sampleDir=path.dirname(input);
let base=value('--base',process.env.THREE_D_TEST_BASE),server=null,browser=null,seedId=null,quality='preview';
const port=Number(value('--port',process.env.THREE_D_TEST_PORT??'5175'));
assert.ok(Number.isInteger(port)&&port>0&&port<=65535);
assert.ok(!reuse||!base,'Cache reuse must use an isolated local task history.');
const original=JSON.parse(await fs.readFile(input,'utf8'));validateTown(original);
const ids=original.districts.filter(d=>d.wardType==='Market').map(d=>d.id).sort();assert.ok(ids.length>1,'Use a planning snapshot with multiple source markets.');
await fs.mkdir(out,{recursive:true});
try {
  if(!base) {
    process.env.SETTLEMENT_3D_JOBS_ROOT=path.join(out,'jobs-'+randomUUID());await fs.mkdir(process.env.SETTLEMENT_3D_JOBS_ROOT,{recursive:true});
    if(reuse) {
      const report=JSON.parse(await fs.readFile(path.join(sampleDir,'verification.json'),'utf8'));
      const signature=JSON.parse(await fs.readFile(path.join(sampleDir,'cache-signature.json'),'utf8'));
      assert.equal(report.status,'pass');assert.equal(report.markets.passed,true);
      assert.deepEqual(report.markets.plazas.map(p=>p.id).sort(),ids);assert.ok(report.markets.plazas.every(p=>p.passed));
      quality=signature.quality;assert.ok(['preview','high'].includes(quality));
      const hit=await inspectCache(sampleDir,{sourceHash:townHash(original),fingerprint:await fingerprints(process.cwd()),quality,view:'center'});
      assert.ok(hit?.result,'The saved sample is not a current verified result; regenerate it rather than silently rendering during this test.');
      seedId=randomUUID();const dir=path.join(process.env.SETTLEMENT_3D_JOBS_ROOT,seedId);await fs.mkdir(dir);
      await copyArtifacts(sampleDir,dir,{images:true,view:'center'});
      await fs.writeFile(path.join(dir,'job.json'),JSON.stringify({id:seedId,status:'complete',stage:'Verified multi-market sample',quality,requestedView:'center',
        createdAt:new Date().toISOString(),finishedAt:new Date().toISOString(),seed:original.resolved.seed,size:original.resolved.size,
        buildings:original.buildings.length,sourceHash:townHash(original),hasCastle:original.resolved.castle},null,2));
    }
    const {createServer}=await import('vite');
    server=await createServer({root:path.resolve('apps/playground'),configFile:path.resolve('apps/playground/vite.config.ts'),
      server:{host:'127.0.0.1',port,strictPort:true},logLevel:'error'});await server.listen();
    const address=server.httpServer.address();assert.ok(address&&typeof address==='object');base='http://127.0.0.1:'+address.port;
  }
  base=base.replace(/\/$/,'');browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1500,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const get=async file=>{const response=await fetch(base+file);assert.equal(response.status,200);return response.json();};
  await page.goto(base+'/?test=1');await page.waitForSelector('body[data-ready="true"]');
  await page.evaluate(text=>window.__playground.load(text),serializeTown(original));
  await page.waitForFunction(()=>!document.querySelector('#three-d-generate').disabled,null,{timeout:120000});
  assert.ok(!(await page.locator('#three-d-support').textContent()).includes('不支持多个市场'));
  await page.selectOption('#three-d-quality',quality);
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/3d/jobs')&&r.request().method()==='POST');
  await page.locator('#three-d-generate').click();const response=await pending;assert.equal(response.status(),202);const submitted=await response.json();
  console.log('MULTI_MARKET_WEB_STARTED',submitted.id,reuse?'cached sample':'generation');
  let finished;
  for(let n=0;n<450;n++) {
    finished=await get('/api/3d/jobs/'+submitted.id);if(!['running','cancelling'].includes(finished.status))break;
    if(n%15===0)console.log('MULTI_MARKET_WEB_PROGRESS',finished.stage);await new Promise(resolve=>setTimeout(resolve,2000));
  }
  assert.equal(finished.status,'complete',JSON.stringify(finished));
  if(reuse){assert.equal(finished.cacheHit,'result');assert.equal(finished.reusedResultFrom,seedId);}
  const report=await localJobJson(finished,'verification.json');assert.equal(report.status,'pass');assert.equal(report.markets.version,1);assert.equal(report.markets.passed,true);
  assert.deepEqual(report.markets.plazas.map(p=>p.id).sort(),ids);assert.ok(report.markets.plazas.every(p=>p.passed));
  const manifest=await localJobJson(finished,'scene-manifest.json');
  assert.equal(manifest.markets.version,1);assert.deepEqual(manifest.markets.plazas.map(p=>p.id).sort(),ids);
  assert.equal(new Set(report.markets.plazas.map(p=>p.groundObject)).size,ids.length,'Every market needs a distinct verified ground object.');
  const contents=new Set();
  for(const market of manifest.markets.plazas) {
    const observed=report.markets.plazas.find(p=>p.id===market.id);assert.equal(market.props.marketId,market.id);
    for(const name of market.objects){assert.ok(!contents.has(name),'One object was assigned to more than one market.');contents.add(name);}
    for(const kind of ['stalls','people','well','cart','cargo_groups'])assert.equal(observed.counts[kind]??0,market.props[kind]??0,market.id+': '+kind+' differs from actual saved objects.');
    if(requireStalls){assert.ok(observed.counts.stalls>0,market.id+' must have actual stalls in this demonstration.');assert.ok(observed.counts.people>0,market.id+' must have actual people in this demonstration.');}
  }
  assert.equal(report.counts.verifiedBuildings,original.buildings.length);
  if(original.river)assert.equal(report.river.passed,true);
  assert.deepEqual(await localJobJson(finished,'source-town.json'),original);
  const imagePath=finished.files['city-center-render.png'];assert.ok(imagePath);
  await page.waitForFunction(image=>{const el=document.querySelector('#three-d-image');return !el.hidden&&el.complete&&el.naturalWidth>0&&el.src.includes(image);},imagePath,{timeout:30000});
  const image=await fetch(base+imagePath);assert.equal(image.status,200);const bytes=Buffer.from(await image.arrayBuffer());
  const width=quality==='preview'?1500:3200;assert.equal(bytes.readUInt32BE(16),width);assert.equal(bytes.readUInt32BE(20),width);
  await assertImageOnlyDownloads(base,finished);
  await page.screenshot({path:path.join(out,'multi-market-city.png')});assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(out,'web-verification.json'),JSON.stringify({passed:true,jobId:finished.id,seedId,cacheHit:finished.cacheHit,quality,
    imageWidth:width,sourceHash:townHash(original),marketIds:ids,markets:report.markets,requireStalls,pageErrors:errors,
    checks:['import unchanged multi-market snapshot','button enabled','browser POST 202','every source market independently passed',
      reuse?'verified result cache reused':'Blender generation','exact submitted source','image display and download','models and reports stay private']},null,2));
  console.log('PASS multi-market web workflow',finished.id,ids.length,'markets');
} finally {if(browser)await browser.close();if(server)await server.close();}
