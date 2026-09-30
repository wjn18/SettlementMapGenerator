import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
import {preview,build} from 'vite';
import {chromium} from '@playwright/test';
import {PNG} from 'pngjs';
import assert from 'node:assert/strict';
const output='artifacts/p5';mkdirSync(output,{recursive:true});
const report={browser:'',platform:process.platform,viewport:[800,800],warmups:3,repetitions:12,method:'API synchronous CPU time plus separately measured two-rAF frame wait; not GPU/compositor timing',samples:{},bundles:{},results:[],lifecycle:[],comparisons:[]};
for(const [sample,file] of [['small','town-1-6.json'],['medium','town-42-15.json'],['large','town-12345-40.json']]){const bytes=readFileSync(`tests/fixtures/p5/${file}`);report.samples[sample]={file,sha256:createHash('sha256').update(bytes).digest('hex')};}
for(const kind of ['openfl','canvas','svg']){
  const result=await build({configFile:false,logLevel:'silent',build:{write:false,minify:true,lib:{entry:path.resolve(`packages/renderer-${kind}/src/index.ts`),formats:['es'],fileName:'renderer'}}});
  const chunks=(Array.isArray(result)?result:[result]).flatMap(r=>r.output).filter(c=>c.type==='chunk'),bytes=chunks.reduce((n,c)=>n+Buffer.byteLength(c.code),0),gzipBytes=chunks.reduce((n,c)=>n+gzipSync(c.code).length,0);
  report.bundles[kind]={bytes,gzipBytes};if(kind!=='openfl')assert(!chunks.some(c=>c.code.includes('handleApplicationEvent')));
}
const server=await preview({root:path.resolve('apps/playground'),preview:{port:0,host:'127.0.0.1'}}),base=`http://127.0.0.1:${server.httpServer.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();
try{
  for(const dpr of [1,2])for(const kind of ['openfl','canvas','svg']){
    const context=await browser.newContext({viewport:{width:800,height:800},deviceScaleFactor:dpr}),page=await context.newPage();
    await page.goto(`${base}/compare.html?test=1&bench=${kind}`);await page.waitForFunction(()=>document.body.dataset.ready==='true');
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    for(const sample of ['small','medium','large']){
      await page.evaluate(sample=>window.__comparison.load(sample),sample);
      for(const zoom of [.5,1,4]){
        await page.evaluate(zoom=>window.__comparison.zoom(zoom),zoom);
        const measurement=await page.evaluate(async({kind,warmups,repetitions})=>{
          const a=window.__comparison,frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const measure=async(fn,before=()=>{})=>{const cpu=[],frames=[];for(let i=-warmups;i<repetitions;i++){before();const t=performance.now();fn(i);const end=performance.now();await frame();if(i>=0){cpu.push(end-t);frames.push(performance.now()-t);}}const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return{median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.ceil(sorted.length*.95)-1],raw:values};};return{cpuMs:stats(cpu),frameWaitMs:stats(frames)};};
          const first=await measure(()=>a.mount(),()=>a.dispose());
          const redraw=await measure(()=>a.redraw());
          const pan=await measure(i=>a.pan(i%2?5:0));a.pan(0);await frame();
          const v=a.views[kind],p=a.scene.hitRegions[0].points[0],x=400+(p.x-v.centerX)*v.zoom,y=400+(p.y-v.centerY)*v.zoom;
          const start=performance.now();let hit;for(let i=0;i<1000;i++)hit=a.pick(kind,x,y);const pickUs=(performance.now()-start);
          return{first,redraw,pan,pickUs,hit,commands:a.scene.commands.length,viewport:v};
        },{kind,warmups:report.warmups,repetitions:report.repetitions});
        const file=`${sample}-${kind}-dpr${dpr}-zoom${zoom}.png`;await page.locator(`#${kind}`).screenshot({path:`${output}/${file}`});
        report.results.push({kind,dpr,sample,zoom,file,...measurement});console.log(`${kind} DPR ${dpr} ${sample} ${zoom}×`);
      }
    }
    const cdp=await context.newCDPSession(page),samples=[];
    for(let i=0;i<30;i++){await page.evaluate(async()=>{const a=window.__comparison;a.dispose();a.mount();a.redraw();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));a.dispose();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});if(i===4||i===14||i===29){await cdp.send('HeapProfiler.collectGarbage');samples.push({cycle:i+1,...await cdp.send('Runtime.getHeapUsage'),...await cdp.send('Memory.getDOMCounters')});}}
    assert(samples.at(-1).usedSize-samples[0].usedSize<2_000_000);assert(samples.at(-1).nodes-samples[0].nodes<100);report.lifecycle.push({kind,dpr,samples});await context.close();
  }
}finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
for(const dpr of [1,2])for(const sample of ['small','medium','large'])for(const zoom of [.5,1,4])for(const kind of ['canvas','svg']){
  const a=PNG.sync.read(readFileSync(`${output}/${sample}-openfl-dpr${dpr}-zoom${zoom}.png`)),b=PNG.sync.read(readFileSync(`${output}/${sample}-${kind}-dpr${dpr}-zoom${zoom}.png`));
  assert.equal(a.width,b.width);let total=0,changed=0;for(let i=0;i<a.data.length;i+=4){let max=0;for(let c=0;c<3;c++){const delta=Math.abs(a.data[i+c]-b.data[i+c]);total+=delta;max=Math.max(max,delta);}if(max>16)changed++;}
  const meanAbsoluteChannelError=total/(a.width*a.height*3),changedPixelRatio=changed/(a.width*a.height);
  report.comparisons.push({kind,dpr,sample,zoom,meanAbsoluteChannelError,changedPixelRatio});
}
writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');console.log(`Saved ${report.results.length} screenshots and report to ${output}`);
assert(report.comparisons.every(c=>c.meanAbsoluteChannelError<8),'Possible rendering regression; inspect the saved report and screenshots');
