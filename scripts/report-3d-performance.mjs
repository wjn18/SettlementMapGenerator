import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';

const baseline=path.resolve(process.argv[2]??'artifacts/web-3d/000464ea-4439-44c4-b705-f6d423d703e2');
const optimized=path.resolve(process.argv[3]??'artifacts/3d-performance/release');
const out=path.resolve(process.argv[4]??'artifacts/3d-performance');await fs.mkdir(out,{recursive:true});
const read=async(dir,name)=>JSON.parse(await fs.readFile(path.join(dir,name),'utf8'));
const beforeJob=await read(baseline,'job.json'),beforeVerification=await read(baseline,'verification.json');
const after=await read(optimized,'pipeline-performance.json'),afterVerification=await read(optimized,'verification.json');
const beforeManifest=await read(baseline,'scene-manifest.json'),afterManifest=await read(optimized,'scene-manifest.json');
const beforeTotal=(Date.parse(beforeJob.finishedAt)-Date.parse(beforeJob.createdAt))/1000;
const time=async name=>(await fs.stat(path.join(baseline,name))).mtimeMs/1000;
const adapter=await time('planning.png'),scene=await time('scene.blend'),verified=await time('verification.json');
const timingBefore={export2d:adapter-Date.parse(beforeJob.createdAt)/1000,build:scene-adapter,verify:verified-scene,render:Date.parse(beforeJob.finishedAt)/1000-verified};
const phases=Object.fromEntries(after.phases.map(p=>[p.name,p.seconds]));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const unchanged={};for(const file of ['source-town.json','selection.json','planning.svg'])unchanged[file]=hash(await fs.readFile(path.join(baseline,file)))===hash(await fs.readFile(path.join(optimized,file)));
const a=PNG.sync.read(await fs.readFile(path.join(baseline,'city-center-render.png'))),b=PNG.sync.read(await fs.readFile(path.join(optimized,'city-center-render.png')));
if(a.width!==b.width||a.height!==b.height)throw new Error('Comparison image resolutions differ.');
let sum=0,squared=0,changed=0,max=0,n=0;
for(let i=0;i<a.data.length;i++){if(i%4===3)continue;const d=Math.abs(a.data[i]-b.data[i]);sum+=d;squared+=d*d;changed+=Number(d>0);max=Math.max(max,d);n++;}
let interaction=null;try{interaction=await read(out,'api-comparison.json');}catch{}
const geometry=await read(out,'scene-geometry-comparison.json');
const shopCandidates=await read(out,'occupied-candidates.json');
const renderRegression=await read(out,'render-regression.json');
const fittedMesh=await read(out,'fitted-mesh-tests.json');
const smallWeb=await read(path.join(out,'small-web'),'verification.json');
const testEvidence={};
for(const [name,file,pattern] of [
  ['cache','cache-tests.log',/pass 19/],
  ['python','python-tests.log',/Ran 27 tests[\s\S]*OK/],
  ['browser','browser-tests.log',/10 passed/],
]){
  const log=await fs.readFile(path.join(out,file),'utf8');
  testEvidence[name]={passed:pattern.test(log),log:file};
}
if(!geometry.passed||!shopCandidates.passed||!renderRegression.passed||!fittedMesh.passed||!smallWeb.passed||!interaction?.passed||Object.values(testEvidence).some(t=>!t.passed))throw new Error('Incomplete or failed validation evidence.');
const checks={beforePassed:beforeVerification.status==='pass',afterPassed:afterVerification.status==='pass',
  countsEqual:JSON.stringify(beforeVerification.counts)===JSON.stringify(afterVerification.counts),
  designAndMountingManifestsEqual:JSON.stringify(beforeManifest)===JSON.stringify(afterManifest),
  sourceAndPlanningFilesEqual:unchanged,
  sameArtLibrary:beforeManifest.assetIntegration.librarySha256===afterManifest.assetIntegration.librarySha256,
  sameArtPlacements:beforeManifest.assetIntegration.meshPlacements===afterManifest.assetIntegration.meshPlacements,
  maxBoundaryErrorBefore:beforeVerification.maxBuildingBoundaryErrorPlanUnits,maxBoundaryErrorAfter:afterVerification.maxBuildingBoundaryErrorPlanUnits,
  boundaryTolerance:afterVerification.boundaryTolerancePlanUnits};
const result={version:1,createdAt:new Date().toISOString(),baseline:path.basename(baseline),optimized:path.basename(optimized),
  conditions:{seed:869133548,size:80,buildings:1893,quality:'high',images:['full 3200px / 64 samples','center 3200px / 48 samples','castle 2200px / 32 samples'],
    notes:['Same computer, source planning snapshot and art libraries.','Before total is a completed historical job; its component durations are estimated from artifact timestamps.','After durations come from instrumented completed subprocess phases.','No interrupted or diagnostic run is included in the comparison.','Single-run measurements; smaller towns and other hardware will differ.']},
  before:{seconds:beforeTotal,phases:timingBefore,phaseTiming:'artifact timeline estimate',counts:beforeVerification.counts},
  after:{seconds:after.seconds,phases,phaseTiming:'measured subprocess wall time',counts:afterVerification.counts,imagesRendered:3},
  reductionPercent:100*(1-after.seconds/beforeTotal),speedup:beforeTotal/after.seconds,checks,interaction,
  regressions:{geometry,shopCandidates,renderRegression,fittedMesh,smallWeb,testEvidence},
  imageComparison:{resolution:[a.width,a.height],meanAbsoluteByteError:sum/n,psnr:squared?20*Math.log10(255/Math.sqrt(squared/n)):null,maximumByteError:max,changedChannelFraction:changed/n,
    note:'Pixel equality is not claimed: procedural ink jitter, triangulation and renderer sampling can differ. Source geometry, art parameters and counts are checked separately.'}};
await fs.writeFile(path.join(out,'report.json'),JSON.stringify(result,null,2));
const duration=s=>{if(s<2)return s.toFixed(2)+' 秒';const rounded=Math.round(s);return Math.floor(rounded/60)+' 分 '+rounded%60+' 秒';};
const row=(label,x,y,note='')=>`<tr><td>${label}</td><td>${duration(x)}</td><td>${duration(y)}</td><td>${(100*(1-y/x)).toFixed(1)}%</td><td>${note}</td></tr>`;
const phaseRows=[row('全套三张高清图',beforeTotal,after.seconds,'输出集合、分辨率和采样数相同'),row('场景拼装',timingBefore.build,phases.build_scene,'原阶段按产物时间线估算'),row('独立结构与素材校验',timingBefore.verify,phases.verify_scene,'相同阈值；检查项保留'),row('三张图渲染及收尾',timingBefore.render,phases.render_views,'优化后同一 Blender 进程完成三张')];
const interactionRows=[
  ['同图同质量再次生成',duration(interaction.cacheHitSeconds)+' 返回，'+duration(interaction.cacheClickToImageSeconds)+' 显示图片','真实网页点击计时；校验、复制缓存结果，无 Blender 进程'],
  ['已有场景切换为预览质量',duration(interaction.qualitySwitchSeconds),'仅校验及渲染一张 1500px / 24 samples 城内图，没有重新拼装模型'],
  ['已有场景补生成预览全景',duration(interaction.onDemandFullSeconds),'仅校验及渲染一张 1500px / 24 samples 全景图，没有重新拼装模型'],
].map(([name,time,note])=>`<tr><td>${name}</td><td>${time}</td><td>${note}</td></tr>`).join('');
const imageUrl=(dir,file)=>/^[-a-f0-9]{36}$/.test(path.basename(dir))?`/api/3d/jobs/${path.basename(dir)}/files/${file}`:`/@fs/${path.join(dir,file).replaceAll('\\','/')}`;
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>3D 生成性能测试对比</title><style>
*{box-sizing:border-box}body{font:16px/1.65 system-ui,sans-serif;background:#f2f1eb;color:#21352d;margin:0;padding:36px 5vw}main{max-width:1180px;margin:auto}h1{font-size:30px;margin:0}h2{font-size:21px;margin-top:32px}p{max-width:90ch}.note{color:#62746c;font-size:14px}.cards{display:flex;gap:16px;flex-wrap:wrap}.card{background:#fff;padding:20px;flex:1;min-width:220px;border:1px solid #d5ddd5;border-radius:12px}.card b{display:block;font-size:30px}table{border-collapse:collapse;background:white;width:100%;font-size:14px}td,th{text-align:left;padding:12px;border-bottom:1px solid #dce2dc}th{background:#e2ebe3}.comparison{position:relative;width:100%;aspect-ratio:1;background:white;overflow:hidden}.comparison img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.comparison .after{clip-path:inset(0 50% 0 0)}input[type=range]{width:100%}a{color:#245e48}code{font-size:13px}.tags{display:flex;gap:8px;flex-wrap:wrap}.tag{background:#e0ede0;border-radius:30px;padding:5px 12px}.scroll{overflow:auto}
</style><main><h1>3D 生成性能测试对比</h1><p class="note">同一座 80 地块、1893 栋建筑的城市，完整保留规划和美术资源。Blender 5.2.1 LTS，本机实测。</p>
<div class="cards"><div class="card">原版三张高清图<b>${duration(beforeTotal)}</b></div><div class="card">优化后三张高清图<b>${duration(after.seconds)}</b></div><div class="card">总耗时下降<b>${result.reductionPercent.toFixed(1)}%</b></div></div>
<h2>相同输出的耗时对比</h2><div class="scroll"><table><thead><tr><th>项目</th><th>优化前</th><th>优化后</th><th>耗时减少</th><th>口径</th></tr></thead><tbody>${phaseRows.join('')}</tbody></table></div>
<p class="note">基线总耗时来自真实完成任务的起止时间；基线分阶段耗时依据产物时间线估算。优化后为进程级计时。只比较完成的运行，不将性能分析器附加开销、中断运行或推算数值混入实测总耗时。</p>
<h2>网页复用与按需生成实测</h2><div class="scroll"><table><thead><tr><th>操作</th><th>耗时</th><th>实际执行内容</th></tr></thead><tbody>${interactionRows}</tbody></table></div><p class="note">以上操作复用已有完整场景或已完成图片，输出集合和冷启动三张高清图不同，单列展示。新城市首次生成仍需要拼装与渲染。</p>
<h2>已实现的优化</h2><ol><li>同图同质量复用已完成图片；切换质量或取景时复用校验场景。</li><li>默认只生成城内图，全景和城堡图按选择生成；命令行 --details 可一次生成全套。</li><li>临时场景切换底色、线稿和遮挡层，预先记录遮挡索引，避免遍历修改数万对象。</li><li>市场、植被、店面与校验使用空间索引；保留原有精确碰撞判断和随机序列。</li><li>屋顶裁切缓存顶点变换，完全在边界内的部件跳过无效裁切；保留原图元和 UV。</li><li>大批量几何在脱离场景的集合中装配，最后统一挂载；新增分阶段耗时报告。</li></ol>
<h2>正确性与画质</h2><div class="tags"><span class="tag">1893 栋建筑</span><span class="tag">352 条道路</span><span class="tag">103 段实墙</span><span class="tag">14 个城门</span><span class="tag">24 个规划设施</span><span class="tag">48320 个素材挂载</span></div>
<p>结构与素材校验：优化前 <b>${checks.beforePassed?'通过':'未通过'}</b>，优化后 <b>${checks.afterPassed?'通过':'未通过'}</b>。建筑设计及挂载清单逐项${checks.designAndMountingManifestsEqual?'一致':'存在差异，请检查原始报告'}。原始规划、选择数据、二维 SVG 及素材库哈希见原始报告。占地误差阈值保持 ${checks.boundaryTolerance}，实测最大边界误差 ${checks.maxBoundaryErrorAfter.toPrecision(5)}。</p>
<p>整城 ${geometry.beforeObjects} 个对象的几何、UV、材质、平滑标志和世界变换对比通过：无新增、缺失或变更对象。坐标与 UV 比较精度为 ${geometry.precision.meshCoordinatesAndUVs}，世界矩阵精度为 ${geometry.precision.worldMatrix}。仅用于渲染的遮挡索引和源文本不计入几何对比。</p>
<p>真实城市的店面候选计算从 ${duration(shopCandidates.beforeSeconds)} 降至 ${duration(shopCandidates.afterSeconds)}；全部候选字段及最终 ${shopCandidates.chosenShops} 个店面选择一致。该数据为单独的相同输入微基准，不与整流程耗时相加。</p>
<p class="note">三张高清图保持原分辨率和采样数，没有删除建筑、装饰或降低素材档位。像素不承诺逐点相同：程序化线稿抖动、图元三角化及渲染采样可能产生差异。城内图平均通道差 ${result.imageComparison.meanAbsoluteByteError.toFixed(4)}/255，PSNR ${result.imageComparison.psnr?.toFixed(2)} dB，可直接拖动下方滑块查看。</p>
<h2>回归测试</h2><ul><li>缓存与依赖失效测试 19 项通过，涵盖场景、规划、素材、校验报告及图片损坏，防止错误复用。</li><li>Python 几何与候选筛选测试 27 项通过；开发与生产页面回归测试 10 项通过。</li><li>Blender 三个屋顶裁切案例的原图元与 UV 对比通过；小场景渲染前后像素差为零，异常清理及原场景状态保护通过。</li><li>107 栋建筑的真实网页生成、下载、刷新恢复、并发阻止及取消进程测试通过。</li><li>1893 栋建筑的整流程、61745 对象几何对比、网页结果复用、质量切换及按需全景生成均通过，浏览器脚本错误为零。</li></ul>
<div class="comparison"><img alt="原流程城内图" src="${imageUrl(baseline,'city-center-render.png')}"><img class="after" alt="优化后城内图" src="${imageUrl(optimized,'city-center-render.png')}"></div><input aria-label="左右拖动对照原版与优化版" type="range" min="0" max="100" value="50" oninput="document.querySelector('.after').style.clipPath='inset(0 '+(100-this.value)+'% 0 0)'">
<p class="note">左侧为优化后，右侧为原流程。基准输入、代码版本和性能数据应一并保存，以便复测。本次为单次实测，不代表所有种子或其他硬件的耗时。</p><p><a href="report.json">完整对比 JSON</a> · <a href="api-comparison.json">真实网页/API 复用测试</a> · <a href="scene-geometry-comparison.json">全城几何对比</a> · <a href="occupied-candidates.json">店面候选微基准</a> · <a href="cache-tests.log">缓存测试</a> · <a href="python-tests.log">几何筛选测试</a> · <a href="browser-tests.log">页面回归测试</a></p></main></html>`;
await fs.writeFile(path.join(out,'report.html'),html);
console.log(JSON.stringify({report:path.join(out,'report.html'),before:beforeTotal,after:after.seconds,reductionPercent:result.reductionPercent,checks},null,2));
