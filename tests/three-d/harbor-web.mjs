// Browser -> local API -> real Blender -> verified download and cache reuse.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateTown } from '@settlement/core';
import { chromium } from '@playwright/test';
import { localJobJson, assertImageOnlyDownloads } from './local-artifacts.mjs';
const out=path.resolve('artifacts/harbor-web-test');await fs.mkdir(out,{recursive:true});
process.env.SETTLEMENT_3D_JOBS_ROOT=path.join(out,'jobs-'+randomUUID());
const {createServer}=await import('vite');
const server=await createServer({root:path.resolve('apps/playground'),configFile:path.resolve('apps/playground/vite.config.ts'),server:{host:'127.0.0.1',port:5193,strictPort:true},logLevel:'error'});
await server.listen();const base='http://127.0.0.1:5193';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1500,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const api=async p=>(await fetch(base+p)).json();
try {
  await page.goto(base+'/?seed=7&size=6&coast=east&harbor=true&river=false&castle=false&walls=false&plaza=true&test=1');
  await page.waitForSelector('body[data-ready="true"]');
  await page.waitForFunction(()=>!document.querySelector('#three-d-generate').disabled,null,{timeout:120000});
  assert.equal(await page.locator('#coast').inputValue(),'east');
  await page.selectOption('#three-d-quality','preview');
  const posted=page.waitForResponse(r=>r.url().endsWith('/api/3d/jobs')&&r.request().method()==='POST');
  await page.locator('#three-d-generate').click();const response=await posted;assert.equal(response.status(),202);const job=await response.json();
  console.log('STARTED',job.id);
  let finished;
  for(let n=0;n<180;n++){
    finished=await api('/api/3d/jobs/'+job.id);if(!['running','cancelling'].includes(finished.status))break;
    await new Promise(r=>setTimeout(r,2000));
  }
  assert.equal(finished.status,'complete',JSON.stringify(finished));
  await page.waitForFunction(()=>document.querySelector('#three-d-image').naturalWidth===1500,null,{timeout:30000});
  const verification=await localJobJson(finished,'verification.json');assert.equal(verification.status,'pass');assert.equal(verification.harbor.passed,true);
  assert.equal(verification.harbor.boatVariants.length,3);assert(verification.harbor.verifiedDocks>0);
  assert(verification.harbor.boats.every(b=>b.dryInteriorPassed&&b.waterIntersections.length===0));
  await assertImageOnlyDownloads(base,finished);
  await page.screenshot({path:path.join(out,'coastal-city.png')});
  // The same coast request must reuse this verified scene/photo.
  const cached=await page.evaluate(async()=>{const town=window.__playground.town;const r=await fetch('/api/3d/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({town,quality:'preview',view:'center'})});return {status:r.status,body:await r.json()};});
  assert.equal(cached.status,202);let cacheJob;
  for(let n=0;n<60;n++){cacheJob=await api('/api/3d/jobs/'+cached.body.id);if(!['running','cancelling'].includes(cacheJob.status))break;await new Promise(r=>setTimeout(r,500));}
  assert.equal(cacheJob.status,'complete');assert.equal(cacheJob.cacheHit,'result');
  const river=generateTown({seed:7,size:6,river:true,castle:false,walls:false,plaza:true});assert(river.ok);
  await page.evaluate(t=>window.__playground.load(JSON.stringify(t)),river.town);
  await page.waitForFunction(()=>!document.querySelector('#three-d-generate').disabled);
  assert.equal(await page.locator('#three-d-generate').isDisabled(),false);
  const estuary=generateTown({seed:7,size:6,river:true,coast:'east',castle:false,walls:false,plaza:true});assert(estuary.ok);
  await page.evaluate(t=>window.__playground.load(JSON.stringify(t)),estuary.town);
  await page.waitForFunction(()=>!document.querySelector('#three-d-generate').disabled);
  assert.equal(await page.locator('#three-d-generate').isDisabled(),false);
  const legacy=structuredClone(estuary.town);delete legacy.river.surface;
  await page.evaluate(t=>window.__playground.load(JSON.stringify(t)),legacy);
  await page.waitForFunction(()=>document.querySelector('#three-d-generate').disabled);
  const rejected=await page.evaluate(async town=>{const r=await fetch('/api/3d/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({town,quality:'preview'})});return r.status;},legacy);assert.equal(rejected,422);
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({passed:true,jobId:job.id,cacheId:cacheJob.id,cacheHit:cacheJob.cacheHit,sceneDirectory:path.join(process.env.SETTLEMENT_3D_JOBS_ROOT,job.id),harbor:verification.harbor,checks:['coastal button enabled','browser submits the current plan','real Blender preview','saved geometry verified','all three vessel variants','models and reports stay private','same-plan cached result','inland river button enabled','river plus coast button enabled','missing legacy river surface rejected'],pageErrors:errors},null,2));
  console.log('PASS coastal web workflow and cache',job.id);
} finally {await browser.close();await server.close();}
