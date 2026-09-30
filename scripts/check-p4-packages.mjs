import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer, build, preview } from 'vite';
import { chromium } from '@playwright/test';
const native=process.argv.includes('--native');
const root=fileURLToPath(new URL('../',import.meta.url)), artifacts=path.join(root,native?'artifacts/p5-packages':'artifacts/p4');
mkdirSync(artifacts,{recursive:true});
const require=createRequire(import.meta.url);
const npmCli=process.env.npm_execpath || path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const npm=(args,cwd)=>{
  const r=spawnSync(process.execPath,[npmCli,...args,'--cache',path.join(root,'.cache/npm')],{cwd,encoding:'utf8',timeout:120000});
  if(r.status!==0) throw new Error(`npm ${args.join(' ')}: ${r.error||r.stderr||r.stdout}`);
  return r.stdout;
};
const packages={};
for(const name of native?['core','map-scene','renderer-canvas','renderer-svg']:['core','map-scene','renderer-openfl']) {
  const [packed]=JSON.parse(npm(['pack','--json','--ignore-scripts','--pack-destination',artifacts],path.join(root,'packages',name)));
  assert(packed.files.some(f=>f.path==='dist/index.js')); assert(packed.files.some(f=>f.path==='dist/index.d.ts')); assert(packed.files.some(f=>f.path==='LICENSE'));
  assert(packed.files.every(f=>f.path.startsWith('dist/')||['README.md','LICENSE','package.json'].includes(f.path)));
  packages[`@settlement/${name}`]={path:path.join(artifacts,packed.filename),integrity:packed.integrity,size:packed.size,files:packed.files.length};
}
const isolated=mkdtempSync(path.join(tmpdir(),'settlement-p4-'));
const coreDir=path.join(isolated,'node'),browserDir=path.join(isolated,'browser');
mkdirSync(coreDir);mkdirSync(browserDir);
const packageJson=(dir,dependencies)=>writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'settlement-consumer',private:true,type:'module',dependencies},null,2));
packageJson(coreDir,{'@settlement/core':`file:${packages['@settlement/core'].path}`});
npm(['install','--offline','--ignore-scripts','--no-audit','--no-fund'],coreDir);
assert(!existsSync(path.join(coreDir,'node_modules/openfl')));
const coreManifest=JSON.parse(readFileSync(path.join(coreDir,'node_modules/@settlement/core/package.json')));
assert.equal(Object.keys(coreManifest.dependencies||{}).length,0);
cpSync(path.join(root,'examples/node'),coreDir,{recursive:true});
writeFileSync(path.join(coreDir,'guard.mjs'),`for (const key of ['window','document','navigator','openfl','performance']) Object.defineProperty(globalThis,key,{configurable:true,get(){throw new Error('Forbidden global: '+key)}});\nMath.random=()=>{throw new Error('Ambient random')};\nglobalThis.Date=class{constructor(){throw new Error('Clock')}static now(){throw new Error('Clock')}};\nawait import('./main.mjs');\n`);
const node=spawnSync(process.execPath,['guard.mjs'],{cwd:coreDir,encoding:'utf8',timeout:30000});assert.equal(node.status,0,node.stderr);
console.log('Independent Node tarball consumer passed');
packageJson(browserDir,Object.fromEntries(Object.entries(packages).map(([name,p])=>[name,`file:${p.path}`])));
npm(['install','--offline','--ignore-scripts','--no-audit','--no-fund'],browserDir);
cpSync(path.join(root,'examples/browser'),browserDir,{recursive:true});
if(native){cpSync(path.join(root,'examples/browser-native'),browserDir,{recursive:true});assert(!existsSync(path.join(browserDir,'node_modules/openfl')));}
for(const name of Object.keys(packages)) assert(realpathSync(path.join(browserDir,'node_modules',name)).startsWith(browserDir));
const tsc=spawnSync(process.execPath,[require.resolve('typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--target','ES2022','--module','ESNext','--moduleResolution','Bundler','main.ts'],{cwd:browserDir,encoding:'utf8'});
assert.equal(tsc.status,0,tsc.stdout+tsc.stderr);
let loaded=0;
const boundary={name:'consumer-boundary',moduleParsed(info){if(info.id.includes('/node_modules/')||info.id.includes('\\node_modules\\')){assert(path.resolve(info.id).startsWith(browserDir),`Workspace dependency leaked: ${info.id}`);if(native)assert(!info.id.includes('node_modules/openfl/'),'OpenFL leaked into native renderer');loaded++;}}};
await build({root:browserDir,logLevel:'error',plugins:[boundary]});assert(loaded>(native?5:300));
const dev=await createServer({root:browserDir,logLevel:'error',server:{host:'127.0.0.1',port:0}});await dev.listen();
const prod=await preview({root:browserDir,logLevel:'error',preview:{host:'127.0.0.1',port:0}});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={packages,node:JSON.parse(node.stdout.trim()),browserVersion:browser.version(),isolatedDependencyModules:loaded,lifecycle:[]};
try {
  for(const [mode,server] of [['dev',dev.httpServer],['production',prod.httpServer]]) for(const dpr of [1,2]) for(const kind of native?['canvas','svg']:['openfl']) {
    const context=await browser.newContext({deviceScaleFactor:dpr,viewport:{width:1000,height:800}}),page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      const add=window.addEventListener,remove=window.removeEventListener,counts=new Map();
      window.addEventListener=function(type,cb,opts){if(!counts.has(type))counts.set(type,new Set());counts.get(type).add(cb);return add.call(this,type,cb,opts);};
      window.removeEventListener=function(type,cb,opts){counts.get(type)?.delete(cb);return remove.call(this,type,cb,opts);};
      const raf=window.requestAnimationFrame,pending=new Set();
      window.requestAnimationFrame=cb=>{const id=raf.call(window,t=>{pending.delete(id);cb(t);});pending.add(id);return id;};
      window.__resources=()=>({listeners:Object.fromEntries([...counts].filter(([,v])=>v.size).map(([k,v])=>[k,v.size])),frames:pending.size});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/?renderer=${kind}`);await page.locator('#status').filter({hasText:'地图就绪'}).waitFor();
    const dimensions=await page.locator('#map > canvas, #map > svg, #map > div canvas').evaluate(c=>[Number(c.getAttribute('width')),Number(c.getAttribute('height'))]);assert.deepEqual(dimensions,kind==='svg'?[800,650]:[800*dpr,650*dpr]);
    const shot=await page.locator('#map').screenshot();assert(shot.length>10000);await page.screenshot({path:path.join(artifacts,`consumer-${kind}-${mode}-dpr${dpr}.png`)});
    if(mode==='dev') {
      const cdp=await context.newCDPSession(page);
      const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.evaluate(async()=>{const api=await import('/main.ts');api.dispose();});await settle();
      const base=await page.evaluate(()=>window.__resources()),samples=[];
      for(let cycle=0;cycle<40;cycle++) {
        await page.evaluate(async()=>{const api=await import('/main.ts');api.mount();api.redraw();});await settle();
        assert.equal(await page.locator('#map > canvas, #map > svg, #map > div canvas').count(),1);
        await page.evaluate(async()=>{const api=await import('/main.ts');api.dispose();});await settle();
        assert.equal(await page.locator('canvas').count(),0);
        assert.deepEqual(await page.evaluate(()=>window.__resources()),base);
        if(cycle===4||cycle%10===9){await cdp.send('HeapProfiler.collectGarbage');samples.push({cycle:cycle+1,...await cdp.send('Runtime.getHeapUsage'),...await cdp.send('Memory.getDOMCounters')});}
      }
      assert(samples.at(-1).usedSize-samples[0].usedSize<2_000_000,'Retained heap grew by more than 2 MB');
      assert(samples.at(-1).nodes-samples[0].nodes<100,'Detached DOM accumulation');
      report.lifecycle.push({kind,dpr,cycles:40,baseline:base,samples});
    }
    assert.deepEqual(errors,[]);await context.close();console.log(`Independent browser ${kind} ${mode} DPR ${dpr} passed`);
  }
} finally { await browser.close();await dev.close();await new Promise(resolve=>prod.httpServer.close(resolve)); }
writeFileSync(path.join(artifacts,'package-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(`Tarballs and report: ${artifacts}`);
