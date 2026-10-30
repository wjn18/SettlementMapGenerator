// Real browser controls, JSON import/export, both renderers and cached 3D submission.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { copyArtifacts,townHash,fingerprints,inspectCache } from '../../apps/playground/server/three-d-cache.mjs';
const out=path.resolve('artifacts/river-harbor-web-test');await fs.mkdir(out,{recursive:true});
process.env.SETTLEMENT_3D_JOBS_ROOT=path.join(out,'jobs-'+randomUUID());await fs.mkdir(process.env.SETTLEMENT_3D_JOBS_ROOT);
const cases=['3d-river-harbor','3d-estuary-river-harbor'],samples=[];
for(const name of cases){
  const dir=path.resolve('artifacts',name),source=JSON.parse(await fs.readFile(path.join(dir,'source-town.json'),'utf8'));
  assert((await inspectCache(dir,{sourceHash:townHash(source),fingerprint:await fingerprints(path.resolve('.')),quality:'preview',view:'center'}))?.result,'Refresh the verified sample '+name);
  const id=randomUUID(),jobDir=path.join(process.env.SETTLEMENT_3D_JOBS_ROOT,id);await fs.mkdir(jobDir);await copyArtifacts(dir,jobDir,{images:true,view:'center'});
  await fs.writeFile(path.join(jobDir,'job.json'),JSON.stringify({id,status:'complete',stage:'Verified river harbor',quality:'preview',requestedView:'center',createdAt:new Date().toISOString(),seed:source.resolved.seed,size:source.resolved.size,buildings:source.buildings.length,sourceHash:townHash(source)}));
  samples.push({name,source,id});
}
const {createServer}=await import('vite');const server=await createServer({root:path.resolve('apps/playground'),configFile:path.resolve('apps/playground/vite.config.ts'),server:{host:'127.0.0.1',port:0},logLevel:'error'});
await server.listen();const base='http://127.0.0.1:'+server.httpServer.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1500,height:1050}}),errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(base+'/?test=1&seed=7&size=12&river=true&riverHarbor=true&walls=false&castle=false&plaza=true');
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await page.locator('#river-harbor').inputValue(),'true');assert.equal(await page.locator('#river-harbor').isEnabled(),true);
  assert(await page.evaluate(()=>window.__playground.town.terrain.docks.some(d=>d.waterbody==='river')));
  await page.selectOption('#river','false');assert.equal(await page.locator('#river-harbor').isDisabled(),true);
  await page.selectOption('#river','true');await page.selectOption('#river-harbor','false');
  const revision=await page.evaluate(()=>window.__playground.revision);await page.click('#generate');
  await page.waitForFunction(n=>window.__playground.revision>n,revision);
  assert.equal(await page.evaluate(()=>window.__playground.town.terrain.docks.filter(d=>d.waterbody==='river').length),0);
  assert.equal(new URL(page.url()).searchParams.get('riverHarbor'),'false');
  for(const sample of samples){
    await page.setInputFiles('#file',{name:'river-harbor.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(sample.source))});
    await page.waitForFunction(expected=>JSON.stringify(window.__playground.town)===expected,JSON.stringify(sample.source));
    assert.equal(await page.locator('#river-harbor').inputValue(),'true');
    assert.deepEqual(await page.evaluate(()=>window.__playground.town),sample.source);
    for(const renderer of ['canvas','svg','openfl']){await page.selectOption('#renderer',renderer);await page.waitForTimeout(200);assert(await page.locator('#map').evaluate(el=>el.children.length>0));}
    await page.selectOption('#renderer','canvas');
    const downloaded=page.waitForEvent('download');await page.click('#export');const download=await downloaded;
    assert.deepEqual(JSON.parse(await fs.readFile(await download.path(),'utf8')),sample.source);
    await page.screenshot({path:path.join(out,sample.name+'-2d.png')});
    await page.waitForFunction(()=>!document.querySelector('#three-d-generate').disabled);await page.selectOption('#three-d-quality','preview');
    const posted=page.waitForResponse(r=>r.url().endsWith('/api/3d/jobs')&&r.request().method()==='POST');await page.click('#three-d-generate');
    const response=await posted;assert.equal(response.status(),202);const job=await response.json();
    assert.equal(job.status,'complete');assert.equal(job.cacheHit,'result');assert.equal(job.reusedResultFrom,sample.id);
    const report=await (await fetch(base+job.files['verification.json'])).json();assert.equal(report.harbor.riverHarbor.passed,true);
    assert.deepEqual(await (await fetch(base+job.files['source-town.json'])).json(),sample.source);
    await page.waitForFunction(image=>{const el=document.querySelector('#three-d-image');return !el.hidden&&el.complete&&el.naturalWidth>0&&el.src.includes(image);},job.files['city-center-render.png']);
    const blend=await fetch(base+job.files['scene.blend']+'?download=1');assert.equal(blend.status,200);assert.match(blend.headers.get('content-disposition'),/attachment/);await blend.body.cancel();
    await page.screenshot({path:path.join(out,sample.name+'-3d.png')});
    results.push({name:sample.name,passed:true,jobId:job.id,cacheHit:job.cacheHit,riverDocks:report.harbor.riverHarbor.verifiedDocks});
    console.log('PASS river harbor web',sample.name);
  }
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'web-verification.json'),JSON.stringify({passed:true,results,pageErrors:errors},null,2));
}finally{await browser.close();await server.close();}
