import { Worker } from 'node:worker_threads';
import { mkdirSync, writeFileSync } from 'node:fs';
import { GENERATOR_VERSION } from '../packages/core/dist/index.js';
const cases=[];
let state=42;
for(let i=0;i<128;i++) {
  state=(state*48271)%2147483647;
  for(const size of [6,15,24,40]) cases.push({seed:state,size});
}
for(const seed of [1,42,2147483646]) for(const size of [6,24,40]) for(const plaza of [false,true]) for(const castle of [false,true]) for(const walls of [false,true]) cases.push({seed,size,plaza,castle,walls});
for(let size=6;size<=40;size++) cases.push({seed:12345,size});
cases.push({seed:1,size:15,maxAttempts:1});
const results=[];
let worker;
function run(options) {
  worker??=new Worker(new URL('../tests/p4/batch-worker.mjs',import.meta.url));
  return new Promise(resolve=>{
    const done=result=>{clearTimeout(timer);worker.removeAllListeners('message');worker.removeAllListeners('error');resolve(result);};
    const timer=setTimeout(()=>{const old=worker;done({options,exception:'Case exceeded 10 second deadline'});worker=null;void old.terminate();},10000);
    worker.once('message',done);worker.once('error',error=>done({options,exception:String(error)}));worker.postMessage(options);
  });
}
try { for(const options of cases) { results.push(await run(options)); if(results.length%100===0) console.log(`Checked ${results.length}/${cases.length}`); } }
finally { await worker?.terminate(); }
const times=results.map(r=>r.elapsedMs).filter(Number.isFinite).sort((a,b)=>a-b);
const summary={total:results.length,successes:results.filter(r=>r.sha256).length,expectedFailures:results.filter(r=>r.error).length,exceptions:results.filter(r=>r.exception).length,outsidePolygons:results.reduce((s,r)=>s+(r.outside||0),0),medianMs:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],maxMs:times.at(-1)};
const report={generatorVersion:GENERATOR_VERSION,node:process.version,platform:process.platform,timeoutMs:10000,checks:['repeat generation','canonical JSON round trip','schema/ring/reference validation','entrance street connectivity','building/feature vertices inside district'],summary,results};
mkdirSync('artifacts/p4',{recursive:true});writeFileSync('artifacts/p4/batch-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
if(summary.exceptions||summary.outsidePolygons||results.some(r=>r.error&&r.options.maxAttempts!==1)) process.exitCode=1;
