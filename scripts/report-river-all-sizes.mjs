import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fingerprints} from '../apps/playground/server/three-d-cache.mjs';

// Photograph/validation evidence is produced by the actual Blender pipeline.
// This script only assembles a browsable delivery index and checks its links.
const root=path.resolve('artifacts/river-all-sizes');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const audit=await read(path.join(root,'independent-audit.json'));
assert.equal(audit.passed,true,'Run the independent audit before publishing this gallery.');
assert.equal(audit.complete,true);assert.equal(audit.largestTamperRequired,true);
const current=await fingerprints(process.cwd());
assert.deepEqual(audit.currentProductionFingerprints,current,'Production code changed after the independent audit.');
const sizes=[6,12,24,40,60,80,100],labels=['村落','小镇','大镇','小城','中城','大城','都会'];
const cases=[];
for(const size of sizes)for(const terrain of ['inland','estuary']) {
  const name=terrain+'-'+size,dir=path.join(root,name);
  const report=await read(path.join(dir,'verification.json'));
  const result=await read(path.join(dir,'case-result.json'));
  const state=await read(path.join(dir,'matrix-state.json'));
  assert.equal(report.status,'pass');assert.equal(result.stage,'rendered');assert.equal(result.passed,true);
  assert.deepEqual(result.fingerprint,current);assert.deepEqual(report.failures,[]);
  for(const [file,expected] of Object.entries(report.sourceFilesSha256))assert.equal(await hash(path.join(dir,file)),expected,name+': '+file);
  assert.equal(await hash(path.join(dir,'city-center-render.png')),state.render.hashes['city-center-render.png']);
  const image=await fs.readFile(path.join(dir,'city-center-render.png'));
  cases.push({name,size,terrain,counts:result.counts,verifiedCounts:report.counts,
    sceneSha256:report.sourceFilesSha256['scene.blend'],imageWidth:image.readUInt32BE(16),
    checks:result.checks,
    files:Object.fromEntries(['city-center-render.png','scene.blend','verification.json','source-town.json','planning.png'].map(file=>[file,name+'/'+file]))});
}
const core=await read(path.join(root,'audit/continuous-size-report.json'));
const geometry=await read(path.join(root,'audit/geometry-report.json'));
assert.equal(core.passed,true);assert.equal(geometry.passed,true);
const reproduction=await read(path.join(root,'issues/short-road-segment/reproduction.json'));
assert.equal(reproduction.results.before.passed,false);assert.equal(reproduction.results.after.passed,true);
const repaired=await read(path.join(root,'inland-24/verification.json'));
const repairedRoad=repaired.roads.find(road=>road.id==='r168');
assert.equal(repairedRoad?.checks.centerlineCoverage,true);assert.equal(repairedRoad?.checks.sourceWidthAndCoordinates,true);
const delivery={version:1,passed:true,createdAt:new Date().toISOString(),sizes,terrains:['inland','estuary'],
  seed:7,scope:'All seven UI presets, with complete Blender scenes and independently verified preview or high-quality photographs. Continuous API sizes and four coast directions additionally have planning/geometry audits.',
  fingerprint:current,cases,issues:[{case:'inland-24',roadId:'r168',problem:'A nonzero source segment shorter than .001 scene units was omitted, leaving a real slit.',
    fix:'Keep every nonzero source segment and verify its original corners; preserve all source data and the existing coverage tolerance.',
    reproduction:'issues/short-road-segment/reproduction.json',before:'issues/short-road-segment/before-verification.json',after:'inland-24/verification.json'}],
  audits:{independent:'independent-audit.json',continuous:'audit/continuous-size-report.json',geometry:'audit/geometry-report.json'}};
await fs.writeFile(path.join(root,'delivery.json'),JSON.stringify(delivery,null,2)+'\n');
const card=item=>`<article><h3>${item.terrain==='inland'?'内陆河 · 城墙与城堡':'河口 · 港口与无墙城市'}</h3><a href="${item.files['city-center-render.png']}"><img loading="lazy" src="${item.files['city-center-render.png']}" alt="${item.size} 地块${item.terrain==='inland'?'内陆河':'河口港城'}样片"></a><p class="status">结构校验通过</p><p>${item.counts.buildings} 栋建筑 · ${item.counts.roads} 条道路 · ${item.counts.bridges} 座桥 · ${item.counts.markets} 个市场 · ${item.imageWidth} px</p><p class="links"><a href="${item.files['scene.blend']}">Blender 场景</a><a href="${item.files['verification.json']}">结构报告</a><a href="${item.files['source-town.json']}">原始规划</a><a href="${item.files['planning.png']}">二维对照</a></p><details><summary>场景 SHA-256</summary><code>${escape(item.sceneSha256)}</code></details></article>`;
const sections=sizes.map((size,index)=>`<section id="size-${size}"><h2>${labels[index]} · ${size} 地块</h2><div class="pair">${cases.filter(item=>item.size===size).map(card).join('')}</div></section>`).join('');
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>河流定居点 · 全规模验收</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f2e9;color:#243830;font:16px/1.65 system-ui,sans-serif}main{max-width:1460px;margin:auto;padding:32px 4vw 70px}h1{font-size:32px;line-height:1.3}h2{margin:34px 0 14px}h3{font-size:18px;margin:16px 20px}.intro{max-width:86ch}.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}article{background:#fffdf8;border:1px solid #d7ddcc;border-radius:12px;overflow:hidden}article img{width:100%;height:auto;display:block}article p,details{margin:10px 20px}a{color:#286049;text-decoration-thickness:1px;text-underline-offset:3px}.links,nav{display:flex;gap:14px;flex-wrap:wrap}.status{font-weight:700;color:#237243}code{display:block;overflow-wrap:anywhere;font-size:12px}nav{position:sticky;top:0;padding:10px 0;background:#f5f2e9ed;backdrop-filter:blur(8px)}.meta{font-size:14px;color:#57685e}.evidence{padding:18px;background:#e8eee0;border-radius:10px}@media(max-width:780px){.pair{grid-template-columns:1fr}main{padding:20px 16px}h1{font-size:26px}}
</style><main><h1>河流定居点 · 全规模验收</h1><p class="intro">全部 7 个界面规模各完成一组内陆河和一组河口港城，共 14 个完整三维场景。内陆组启用城墙、城堡和市场；河口组为东向海岸、港口与无墙组合。全部采用 seed 7 的真实生成规划，保留建筑、道路、桥梁和地块，逐场景读取保存网格进行结构校验。</p><p class="meta">图像为 1500 像素预览或更高分辨率成图，点击可查看原图。每张图链接同源场景、原规划及校验报告。</p><nav>${sizes.map((size,index)=>`<a href="#size-${size}">${labels[index]} ${size}</a>`).join('')}</nav><div class="evidence"><b>14 / 14 结构校验通过</b><p>独立检查来源实体、文件哈希、岸坡闭合、桥梁承接与通路、市场和城防。最大内陆及河口场景另外进行了真实网格破坏测试。接口连续整数规模 6–100 另有核心生成与能力检查，四向海岸有水陆几何回归；这些规划检查与 14 组三维实测分别记录。</p><p class="links"><a href="independent-audit.json">独立验收汇总</a><a href="delivery.json">交付清单</a><a href="audit/continuous-size-report.json">连续规模规划检查</a><a href="audit/geometry-report.json">水陆几何检查</a></p><p><b>本轮修复：</b>24 档内陆城的一条极短非零道路被路面构造跳过，形成细缝。现已保留全部非零源路段，源规划与校验容差保持一致。144 个 float32 回读采样的最大偏差从 0.000471 降为 0.00000166，14 组场景均用修复后的生成器重建。</p><p class="links"><a href="issues/short-road-segment/before-verification.json">原始失败报告</a><a href="issues/short-road-segment/reproduction.json">修复前后复现</a><a href="inland-24/verification.json">修复后完整验收</a></p></div>${sections}<p class="meta">生成于 ${escape(delivery.createdAt)}。场景和报告保留 SHA-256，图片渲染不会改变已验证的场景文件。</p></main></html>`;
await fs.writeFile(path.join(root,'index.html'),html);
console.log(JSON.stringify({passed:true,cases:cases.length,gallery:path.join(root,'index.html'),delivery:path.join(root,'delivery.json')},null,2));
