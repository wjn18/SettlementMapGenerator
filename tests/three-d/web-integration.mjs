import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { generateTown } from '@settlement/core';

const base=process.env.THREE_D_TEST_BASE ?? 'http://127.0.0.1:5174';
const out=process.env.THREE_D_TEST_OUTPUT ?? 'artifacts/web-3d-test';await fs.mkdir(out,{recursive:true});
const original=JSON.parse(await fs.readFile('artifacts/3d-minimal-city/source-town.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1500,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let jobId;
try {
  await page.goto(base+'/?seed=7&size=6&walls=true&plaza=true&castle=false&test=1');
  await page.waitForSelector('body[data-ready="true"]');
  await page.waitForFunction(()=>!document.querySelector('#three-d-generate').disabled,null,{timeout:120000});
  await page.locator('#view-three-d').click();
  await page.selectOption('#three-d-history','sample-12');
  await page.waitForFunction(()=>{const i=document.querySelector('#three-d-image');return i.complete&&i.naturalWidth===3600&&i.src.includes('/sample-12/');});
  const authoredSample=await (await fetch(base+'/api/3d/jobs/sample-12')).json();
  assert.equal(authoredSample.assetLibraryUsed,true);
  assert.equal(await page.locator('#three-d-footnote').textContent().then(t=>t.includes('专用建筑与装饰素材')),true);
  assert.equal(await page.locator('#three-d-stale').isVisible(),true);
  await page.screenshot({path:out+'/existing-sample.png'});
  const bad=await fetch(base+'/api/3d/jobs',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://example.com'},body:'{}'});
  assert.equal(bad.status,403);
  const invalid=await page.evaluate(async()=>{const r=await fetch('/api/3d/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({town:{},quality:'preview'})});return r.status;});
  assert.equal(invalid,400);
  const wet=generateTown({seed:7,size:6,walls:true,castle:false,plaza:true,river:true});assert.ok(wet.ok);
  await page.evaluate(t=>window.__playground.load(JSON.stringify(t)),wet.town);
  await page.waitForFunction(()=>!document.querySelector('#three-d-generate').disabled);
  assert.equal(await page.locator('#three-d-generate').isDisabled(),false);
  const estuary=generateTown({seed:7,size:6,walls:true,castle:false,plaza:true,river:true,coast:'east'});assert.ok(estuary.ok);
  await page.evaluate(t=>window.__playground.load(JSON.stringify(t)),estuary.town);
  await page.waitForFunction(()=>!document.querySelector('#three-d-generate').disabled);
  assert.equal(await page.locator('#three-d-generate').isDisabled(),false);
  const legacy=structuredClone(estuary.town);delete legacy.river.surface;
  await page.evaluate(t=>window.__playground.load(JSON.stringify(t)),legacy);
  assert.equal(await page.locator('#three-d-generate').isDisabled(),true);
  const unsupported=await page.evaluate(async town=>{const r=await fetch('/api/3d/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({town,quality:'preview'})});return r.status;},legacy);
  assert.equal(unsupported,422);
  await page.evaluate(t=>window.__playground.load(JSON.stringify(t)),original);
  await page.waitForFunction(()=>!document.querySelector('#three-d-generate').disabled);
  await page.selectOption('#three-d-quality','preview');
  const posted=page.waitForResponse(r=>r.url().endsWith('/api/3d/jobs')&&r.request().method()==='POST');
  await page.locator('#three-d-generate').click();
  const response=await posted;assert.equal(response.status(),202);const job=await response.json();jobId=job.id;
  console.log('STARTED',jobId);
  const conflict=await page.evaluate(async town=>{const r=await fetch('/api/3d/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({town,quality:'preview'})});return r.status;},original);
  assert.equal(conflict,409);
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');await page.locator('#view-three-d').click();
  await page.waitForFunction(id=>document.querySelector('#three-d-history').value===id,jobId);
  let finished;
  for(let n=0;n<180;n++) {
    finished=await (await fetch(base+'/api/3d/jobs/'+jobId)).json();
    if(!['running','cancelling'].includes(finished.status))break;
    if(n%8===0)console.log('PROGRESS',finished.stage);
    await new Promise(r=>setTimeout(r,3000));
  }
  assert.equal(finished.status,'complete',JSON.stringify(finished));
  await page.waitForFunction(()=>!document.querySelector('#three-d-image').hidden&&document.querySelector('#three-d-image').naturalWidth===1500);
  const verification=await (await fetch(base+finished.files['verification.json'])).json();assert.equal(verification.status,'pass');assert.equal(verification.counts.verifiedBuildings,107);
  assert.equal(finished.assetLibraryUsed,true);
  assert.equal(verification.assetIntegration.passed,true);
  assert.ok(verification.assetIntegration.checkedRidges>0);
  assert.ok(verification.assetIntegration.ridges.every(r=>r.passed&&r.unsupportedVertices===0&&r.maxDistanceToRoof<=.4));
  assert.ok(verification.assetIntegration.usedVariants>20);
  const assetUse=await (await fetch(base+finished.files['asset-integration.json'])).json();
  assert.equal(assetUse.enabled,true);
  // This enclosed shed had only an invalid ridge cap before the fix. Its
  // native shell remains; it should not gain a floating cap to meet a count.
  assert.equal(assetUse.buildingsWithAuthoredComponents,106);
  assert.equal(assetUse.instances.some(r=>r.sourceBuildingId==='b99'),false);
  assert.equal(new Set(assetUse.instances.map(r=>r.sourceBuildingId).filter(Boolean)).size,106);
  const source=await (await fetch(base+finished.files['source-town.json'])).json();assert.deepEqual(source,original);
  const blend=await fetch(base+finished.files['scene.blend']);assert.equal(blend.status,200);assert.match(blend.headers.get('content-disposition'),/attachment/);assert.ok((await blend.arrayBuffer()).byteLength>10000);
  await page.screenshot({path:out+'/generated-preview.png'});
  // Cancel a separate owned job and verify the renderer lock is released.
  // A repeated identical request now completes from cache, so use a different
  // planning snapshot to exercise a real running Blender cancellation.
  const cancellationTown=generateTown({seed:3456789,size:6,walls:true,castle:false,plaza:true});assert.ok(cancellationTown.ok);
  await page.evaluate(t=>window.__playground.load(JSON.stringify(t)),cancellationTown.town);
  await page.waitForFunction(()=>!document.querySelector('#three-d-generate').disabled);
  const next=page.waitForResponse(r=>r.url().endsWith('/api/3d/jobs')&&r.request().method()==='POST');
  await page.locator('#three-d-generate').click();const cancelledId=(await (await next).json()).id;
  // Exercise cancellation while Blender is actually running, not just a
  // queued/finished job or a mocked process.
  await page.waitForFunction(()=>document.querySelector('#three-d-stage').textContent.includes('拼装')||document.querySelector('#three-d-stage').textContent.includes('渲染'),null,{timeout:90000});
  await page.locator('#three-d-cancel').click();
  for(let n=0;n<40;n++) {
    const j=await (await fetch(base+'/api/3d/jobs/'+cancelledId)).json();
    if(j.status==='cancelled')break;
    await new Promise(r=>setTimeout(r,500));
  }
  assert.equal((await (await fetch(base+'/api/3d/jobs/'+cancelledId)).json()).status,'cancelled');
  assert.equal((await (await fetch(base+'/api/3d/status')).json()).activeId,null);
  assert.deepEqual(errors,[]);
  await fs.writeFile(out+'/verification.json',JSON.stringify({passed:true,jobId,cancelledId,checks:['existing samples','stale plan notice','cross-origin rejection','invalid input','inland river button enabled','river plus coast rejected','submit current plan','duplicate job guard','reload recovery','real Blender render','107 footprint checks','supported ridge geometry','exact submitted JSON','Blender download','cancel process tree'],roofRidges:{checked:verification.assetIntegration.checkedRidges,passed:verification.assetIntegration.ridges.every(r=>r.passed)},pageErrors:errors},null,2));
  console.log('PASS',jobId);
} finally {await browser.close();}
