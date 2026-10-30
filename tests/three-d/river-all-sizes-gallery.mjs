// Local gallery -> real Chrome -> all fourteen delivered image/scene/source
// links. This test needs no web server and never changes delivery artifacts.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2),option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
for(let i=0;i<args.length;i++) {
  assert.ok(['--root','--output'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--'),'Unknown option or missing value: '+args[i]);i++;
}
const root=path.resolve(workspace,option('--root','artifacts/river-all-sizes'));
const out=path.resolve(workspace,option('--output',root));
const sizes=[6,12,24,40,60,80,100],terrains=['inland','estuary'];
const read=async name=>JSON.parse(await fs.readFile(path.join(root,name),'utf8'));
const digest=async name=>createHash('sha256').update(await fs.readFile(path.join(root,name))).digest('hex');
const delivery=await read('delivery.json'),audit=await read('independent-audit.json');
assert.equal(delivery.passed,true);assert.equal(audit.passed,true);assert.equal(audit.complete,true);
assert.equal(audit.largestTamperRequired,true);assert.deepEqual(delivery.sizes,sizes);
assert.deepEqual(delivery.terrains,terrains);assert.equal(delivery.cases.length,14);
assert.deepEqual(delivery.cases.map(item=>item.name).sort(),terrains.flatMap(terrain=>sizes.map(size=>terrain+'-'+size)).sort());
await fs.mkdir(out,{recursive:true});
const pageErrors=[],browser=await chromium.launch({channel:'chrome',headless:true});
const startedAt=new Date().toISOString();
let result;
try {
  const page=await browser.newPage({viewport:{width:1500,height:1050},deviceScaleFactor:1});
  page.on('pageerror',error=>pageErrors.push(error.message));
  const failedRequests=[];page.on('requestfailed',request=>failedRequests.push({url:request.url(),error:request.failure()?.errorText}));
  await page.goto(pathToFileURL(path.join(root,'index.html')).href,{waitUntil:'load'});
  assert.match(await page.title(),/河流定居点/);
  assert.equal(await page.locator('section[id^="size-"]').count(),7);
  const nav=await page.locator('nav a').evaluateAll(links=>links.map(link=>({href:link.getAttribute('href'),text:link.textContent})));
  assert.deepEqual(nav.map(item=>item.href),sizes.map(size=>'#size-'+size));
  assert.ok(nav.every((item,index)=>item.text.includes(String(sizes[index]))));
  // Scroll each lazy image into view so successful HTML alone cannot hide a
  // missing lower-page photograph or a broken file URL.
  const images=page.locator('article img');assert.equal(await images.count(),14);
  for(let index=0;index<14;index++) {
    await images.nth(index).scrollIntoViewIfNeeded();
    await images.nth(index).evaluate(image=>new Promise((resolve,reject)=>{
      const check=()=>image.complete&&image.naturalWidth>=1500&&image.naturalHeight>=1500;
      if(check()){resolve();return;}
      const timer=setTimeout(()=>reject(new Error('Gallery image did not load: '+image.src)),30000);
      image.addEventListener('load',()=>{clearTimeout(timer);check()?resolve():reject(new Error('Gallery image is too small: '+image.src));},{once:true});
      image.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Gallery image failed: '+image.src));},{once:true});
    }));
  }
  const cards=await page.locator('article').evaluateAll(elements=>elements.map(article=>({
    section:article.closest('section').id,title:article.querySelector('h3').textContent,
    image:{url:article.querySelector('img').src,width:article.querySelector('img').naturalWidth,height:article.querySelector('img').naturalHeight},
    links:[...article.querySelectorAll('a')].map(link=>link.href),status:article.querySelector('.status').textContent,
  })));
  const checked=[];
  for(let index=0;index<cards.length;index++) {
    const card=cards[index],item=delivery.cases[index];
    assert.equal(card.section,'size-'+item.size);assert.match(card.status,/结构校验通过/);
    const expectedFiles=Object.values(item.files).map(file=>path.resolve(root,file));
    const actualFiles=card.links.map(url=>fileURLToPath(url));
    assert.deepEqual(actualFiles.sort(),expectedFiles.sort(),item.name+': card omitted or added an artifact link.');
    assert.equal(fileURLToPath(card.image.url),path.resolve(root,item.files['city-center-render.png']));
    assert.ok(card.image.width===card.image.height&&card.image.width>=1500);
    const structural=await read(item.files['verification.json']);
    const source=await read(item.files['source-town.json']);
    assert.equal(structural.status,'pass');assert.deepEqual(structural.failures,[]);
    assert.equal(source.request.size,item.size);assert.ok(source.river.surface.length>=3);
    assert.equal(Boolean(source.terrain?.coast),item.terrain==='estuary');
    assert.equal(await digest(item.files['scene.blend']),item.sceneSha256);
    assert.equal(structural.sourceFilesSha256['scene.blend'],item.sceneSha256);
    checked.push({name:item.name,imageWidth:card.image.width,sceneSha256:item.sceneSha256,files:item.files});
  }
  // Check every local anchor, including aggregate audits and planning images.
  const anchors=await page.locator('a').evaluateAll(links=>links.map(link=>({url:link.href,raw:link.getAttribute('href')})));
  const files=new Set();
  for(const {url,raw} of anchors) {
    if(raw.startsWith('#')) {
      assert.ok(sizes.some(size=>raw==='#size-'+size),'Unexpected navigation target: '+raw);continue;
    }
    const parsed=new URL(url);assert.equal(parsed.protocol,'file:');
    const file=fileURLToPath(parsed),relative=path.relative(root,file);
    assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'A gallery file link leaves the delivery directory: '+url);
    assert.ok((await fs.stat(file)).isFile(),'A gallery link does not point to a real file: '+file);
    files.add(relative.replaceAll(path.sep,'/'));
  }
  for(const size of sizes) {
    await page.locator('nav a[href="#size-'+size+'"]').click();
    assert.equal(new URL(page.url()).hash,'#size-'+size);
    const top=await page.locator('#size-'+size).evaluate(element=>element.getBoundingClientRect().top);
    assert.ok(Math.abs(top)<100,'Scale navigation did not scroll to its section: '+size);
  }
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:path.join(out,'gallery-full-page.png'),fullPage:true});
  assert.deepEqual(pageErrors,[]);assert.deepEqual(failedRequests,[]);
  result={passed:true,startedAt,finishedAt:new Date().toISOString(),gallery:path.join(root,'index.html'),
    sizes,cases:checked,loadedImages:cards.length,checkedFileLinks:files.size,navigation:nav,
    pageErrors,failedRequests,screenshot:'gallery-full-page.png',
    gallerySha256:await digest('index.html'),deliverySha256:await digest('delivery.json'),auditSha256:await digest('independent-audit.json'),
    checks:['all seven scale navigation targets','all fourteen original images loaded in Chrome','all source/scene/report/planning links exist',
      'saved scene SHA matches structural report and delivery','unchanged source size and river/coast planning','no browser page errors','full-page screenshot']};
  await fs.writeFile(path.join(out,'gallery-verification.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({passed:true,images:cards.length,scales:sizes.length,checkedFileLinks:files.size,report:path.join(out,'gallery-verification.json')},null,2));
} finally {await browser.close();}
