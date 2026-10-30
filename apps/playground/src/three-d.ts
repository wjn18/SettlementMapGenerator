import { serializeTown } from '@settlement/core';
import type { TownData } from '@settlement/core';
import { riverSupportError } from '../shared/three-d-support.mjs';
import './three-d.css';

type View = 'center'|'full'|'castle';
type Job = { id:string;status:string;stage:string;quality:string;createdAt:string;finishedAt?:string;seed:number;size:number;buildings:number;sourceHash:string;sample?:boolean;canRecover?:boolean;recoveredFrom?:string;requestedView?:View;hasCastle?:boolean;cacheHit?:string;reusedSceneFrom?:string;reusedResultFrom?:string;assetLibraryUsed?:boolean;error?:string;errorSummary?:string;files:Record<string,string> };
export function createThreeD(getTown:()=>TownData|null) {
  const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
  const controls=document.createElement('section');controls.className='three-d-controls';
  controls.innerHTML=`<div class="section-title">三维场景</div>
    <label for="three-d-quality">输出质量</label><select id="three-d-quality"><option value="preview">快速预览 · 1500 px</option><option value="high">高清图 · 3200 px</option></select>
    <button id="three-d-generate" class="primary" type="button" disabled>生成当前地图的 3D ↗</button>
    <p id="three-d-support" class="note">正在连接本地三维服务…</p>`;
  document.querySelector('.population-card')!.before(controls);
  const tabs=document.createElement('nav');tabs.className='three-d-tabs';tabs.setAttribute('aria-label','地图视图');
  tabs.innerHTML='<button type="button" id="view-plan" aria-pressed="true">平面规划</button><button type="button" id="view-three-d" aria-pressed="false">三维效果</button><span>规划驱动 · 线稿淡彩</span>';
  document.querySelector('.cartography-tools')!.before(tabs);
  const panel=document.createElement('section');panel.id='three-d-panel';panel.hidden=true;panel.setAttribute('aria-label','三维场景结果');
  panel.innerHTML=`<div class="three-d-toolbar"><label for="three-d-history">历史结果</label><select id="three-d-history"><option value="">暂无结果</option></select><select id="three-d-framing" aria-label="三维取景"><option value="center">城内放大</option><option value="full">完整全景</option><option value="castle">城堡局部</option></select></div>
    <div class="three-d-job"><strong id="three-d-title">从当前平面图生成三维场景</strong><span id="three-d-meta"></span><p id="three-d-stage" role="status" aria-live="polite">可先查看历史样片，或点击左侧生成按钮。</p><progress id="three-d-progress" aria-label="三维生成进行中" hidden></progress><button id="three-d-cancel" type="button" hidden>取消生成</button><p id="three-d-stale" hidden>此结果对应生成时的规划快照，与当前平面图不同。</p><p id="three-d-error" role="alert" hidden></p></div>
    <div class="three-d-picture"><img id="three-d-image" alt="规划生成的三维轴测渲染图" hidden><div id="three-d-empty">当前还没有三维图<br><small>本机生成通常需要数分钟，完成后会自动显示。</small></div></div>
    <div id="three-d-downloads" class="three-d-downloads"></div><p id="three-d-footnote" class="three-d-footnote">效果图预览 · 下载 Blender 场景可旋转和编辑。</p>`;
  document.querySelector('.map-shell')!.append(panel);
  const generate=$<HTMLButtonElement>('three-d-generate'),history=$<HTMLSelectElement>('three-d-history');
  const img=$<HTMLImageElement>('three-d-image'),framing=$<HTMLSelectElement>('three-d-framing');
  const technical=document.createElement('details');technical.className='three-d-technical';technical.hidden=true;
  const technicalTitle=document.createElement('summary');technicalTitle.textContent='技术详情';
  const technicalLog=document.createElement('pre');technical.append(technicalTitle,technicalLog);$('three-d-error').after(technical);
  let available=false,busy=false,activeId:string|null=null,selected='',jobs:Job[]=[],currentHash='',hashRevision=0,desiredImage='',explicitSelection=false,requestError='';
  try{selected=new URLSearchParams(location.search).get('job')??localStorage.getItem('settlement-3d-job')??'';}catch{}
  explicitSelection=Boolean(selected);
  const running=(j:Job)=>['running','cancelling'].includes(j.status);
  function show(threeD:boolean) {
    panel.hidden=!threeD;$('view-plan').setAttribute('aria-pressed',String(!threeD));$('view-three-d').setAttribute('aria-pressed',String(threeD));
    $('map').style.visibility=threeD?'hidden':'';
    for(const selector of ['.cartography-tools','.district-legend','.bottom-bar']) (document.querySelector(selector) as HTMLElement).hidden=threeD;
    if(threeD){$('names-panel').hidden=true;$('tooltip').hidden=true;}
  }
  $('view-plan').onclick=()=>show(false);$('view-three-d').onclick=()=>show(true);
  if(new URLSearchParams(location.search).get('view')==='3d')show(true);
  function unsupported(t:TownData|null) {
    if(!t)return '请先生成或导入平面图';
    const riverError=riverSupportError(t);if(riverError)return riverError;
    return '';
  }
  function buttons() {
    const reason=unsupported(getTown());generate.disabled=!available||!!reason||!!activeId||busy;
    $('three-d-support').textContent=!available?'本地三维服务不可用，请用开发服务启动并安装 Blender。':reason|| (activeId?'已有任务正在生成，可切换到三维效果查看进度。':'支持内陆河港、河口海港与河港、石拱桥及多个市场广场。河港混合停靠无桅货船和货运帆船，沿用二维规划的泊位和预留水路。');
  }
  function error(message:string) {$('three-d-error').textContent=message;$('three-d-error').hidden=!message;}
  function picture(job:Job,view:View) {
    if(job.requestedView)return job.files[view==='center'?'city-center-render.png':view==='full'?'scene-render.png':'castle-wall-detail.png'];
    return view==='castle'?job.files['castle-wall-detail.png']:view==='center'?(job.files['city-center-render.png']??job.files['scene-render.png']??job.files['render-preview.png']):(job.files['scene-render.png']??job.files['render-preview.png']);
  }
  function paint() {
    buttons();const job=jobs.find(j=>j.id===selected);
    if(!job)return;
    $('three-d-title').textContent=`${job.id==='sample-river-harbor'?'内陆河港样片':job.id==='sample-estuary-river-harbor'?'河口双港样片':job.id==='sample-markets'?'多市场河城样片':job.id==='sample-estuary'?'河口定居点样片':job.id==='sample-river'?'穿城河样片':job.sample?'已有样片':'三维场景'} · ${job.size===6?'村落':job.size===12?'小镇':`规模 ${job.size}`}`;
    $('three-d-meta').textContent=`种子 ${job.seed} · ${job.buildings} 栋建筑 · ${job.quality==='preview'?'快速预览':'高清渲染'}`+(job.cacheHit==='result'?' · 复用已完成结果':job.reusedSceneFrom?' · 复用已保存场景':'');
    $('three-d-footnote').textContent='效果图预览 · 下载 Blender 场景可旋转和编辑。'+(job.assetLibraryUsed?'已使用专用建筑与装饰素材，保留原规划占地。':job.status==='complete'?'此历史结果使用早期通用素材，重新生成可使用新素材。':'');
    const elapsed=Math.max(0,Math.floor(((job.finishedAt?Date.parse(job.finishedAt):Date.now())-Date.parse(job.createdAt))/1000));
    $('three-d-stage').textContent=job.stage+(running(job)?` · 已用时 ${Math.floor(elapsed/60)}分${elapsed%60}秒`:'');
    $('three-d-progress').hidden=!running(job);$('three-d-cancel').hidden=!running(job);
    let retry=$('three-d-retry') as HTMLButtonElement|null;
    if(!retry){retry=document.createElement('button');retry.id='three-d-retry';retry.type='button';retry.textContent='复用已保存场景重试';$('three-d-cancel').after(retry);
      retry.onclick=async()=>{if(!selected||retry!.disabled)return;busy=true;requestError='';paint();try{const next=await api(`/api/3d/jobs/${selected}/retry`,{});jobs.unshift(next);activeId=next.id;choose(next.id);await refresh();}catch(e){requestError=e instanceof Error?e.message:String(e);error(requestError);}finally{busy=false;buttons();retry!.disabled=!!activeId;}};}
    retry.hidden=!job.canRecover;retry.disabled=busy||!!activeId;
    ($('three-d-cancel') as HTMLButtonElement).disabled=job.status==='cancelling';
    $('three-d-stale').hidden=!currentHash||currentHash===job.sourceHash;
    const castle=job.hasCastle??Boolean(job.files['castle-wall-detail.png']);
    framing.querySelector<HTMLOptionElement>('option[value="castle"]')!.disabled=!castle;
    if(framing.value==='castle'&&!castle)framing.value='center';
    const image=picture(job,framing.value as View);
    framing.disabled=job.status!=='complete'||busy||!!activeId||(!job.requestedView&&!job.files['city-center-render.png']&&!castle);
    desiredImage=image??'';
    if(image && img.getAttribute('src')!==image){img.hidden=true;img.src=image;}
    else img.hidden=!image||!img.complete||img.naturalWidth===0;
    $('three-d-empty').hidden=!img.hidden;
    $('three-d-empty').textContent=image?'正在加载三维图…':running(job)?'正在生成，完成后会自动显示。':'当前还没有三维图，可重新生成。';
    error(job.status==='failed'?(job.errorSummary??job.error??job.stage):requestError);
    technical.hidden=job.status!=='failed'||!job.errorSummary||!job.error;
    technicalLog.textContent=job.error??'';
    const links=$('three-d-downloads');links.replaceChildren();
    for(const [file,label] of [[image,'打开原图'],[job.files['scene.blend'],'下载 Blender 场景'],[job.files['source-town.json'],'规划 JSON'],[job.files['verification.json'],'校验报告'],[job.files['asset-integration.json'],'素材使用清单'],[job.files['pipeline-performance.json'],'耗时报告']] as const) {
      if(!file)continue;const a=document.createElement('a');a.textContent=label;a.href=file;
      if(label==='打开原图'){a.target='_blank';a.rel='noopener';}else a.href+='?download=1';links.append(a);
    }
  }
  function choose(id:string) {explicitSelection=true;selected=id;history.value=id;requestError='';const job=jobs.find(j=>j.id===id);if(job?.requestedView)framing.value=job.requestedView;
    try{localStorage.setItem('settlement-3d-job',id);const url=new URL(location.href);url.searchParams.set('job',id);window.history.replaceState(null,'',url);}catch{}paint();}
  history.onchange=()=>choose(history.value);
  framing.onchange=async()=>{
    const job=jobs.find(j=>j.id===selected),view=framing.value as View;
    if(!job||picture(job,view)||job.status!=='complete'||!job.requestedView){paint();return;}
    busy=true;requestError='';paint();error('');
    try {const next=await api(`/api/3d/jobs/${job.id}/render`,{view});jobs.unshift(next);activeId=running(next)?next.id:null;choose(next.id);await refresh();}
    catch(e){framing.value=job.requestedView??'center';requestError=e instanceof Error?e.message:String(e);paint();}
    finally{busy=false;buttons();framing.disabled=!!activeId;}
  };
  async function api(url:string,body?:unknown) {
    const res=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!res.headers.get('content-type')?.includes('application/json'))throw new Error('三维服务未启动，请使用本地开发服务');
    const data=await res.json();if(!res.ok)throw new Error(data.error??'请求失败');return data;
  }
  let loading=false;
  async function refresh() {
    if(loading)return;loading=true;
    try {
      const state=await api('/api/3d/status');available=state.available;activeId=state.activeId;jobs=state.jobs;
      const signature=jobs.map(j=>`${j.id}:${j.status}`).join('|');
      if(history.dataset.signature!==signature) {
        history.dataset.signature=signature;history.replaceChildren();
        for(const j of jobs)history.add(new Option(`${j.id==='sample-river-harbor'?'内陆河港样片':j.id==='sample-estuary-river-harbor'?'河口双港样片':j.id==='sample-markets'?'多市场河城样片':j.id==='sample-estuary'?'河口定居点样片':j.id==='sample-river'?'穿城河样片':j.sample?'已有样片'+(j.assetLibraryUsed?' · 新素材':' · 早期素材'):new Date(j.createdAt).toLocaleTimeString('zh-CN')} · 规模 ${j.size} · ${j.buildings} 栋${running(j)?' · 生成中':j.status==='failed'?' · 失败':j.status==='cancelled'?' · 已取消':''}`,j.id));
      }
      if(!jobs.some(j=>j.id===selected))selected=activeId??jobs.find(j=>j.status==='complete')?.id??jobs[0]?.id??'';
      if(!explicitSelection&&!activeId&&currentHash)selected=jobs.find(j=>j.status==='complete'&&j.sourceHash===currentHash)?.id??selected;
      history.value=selected;paint();
    } catch {available=false;buttons();}finally{loading=false;}
  }
  generate.onclick=async()=>{
    const town=getTown();if(!town||generate.disabled)return;
    busy=true;requestError='';buttons();show(true);error('');
    try {const job=await api('/api/3d/jobs',{town,quality:($('three-d-quality') as HTMLSelectElement).value});jobs.unshift(job);activeId=running(job)?job.id:null;choose(job.id);await refresh();}
    catch(e){requestError=e instanceof Error?e.message:String(e);error(requestError);}
    finally{busy=false;buttons();}
  };
  $('three-d-cancel').onclick=async()=>{try{await api(`/api/3d/jobs/${selected}/cancel`,{});await refresh();}catch(e){error(String(e));}};
  img.onerror=()=>error('图像加载失败，请重新选择结果或打开高清图。');
  img.onload=()=>{if(desiredImage&&img.getAttribute('src')===desiredImage){img.hidden=false;$('three-d-empty').hidden=true;}};
  const interval=setInterval(()=>void refresh(),2500);window.addEventListener('pagehide',()=>clearInterval(interval),{once:true});
  void refresh();
  return {async update() {
    buttons();const town=getTown(),revision=++hashRevision;
    if(!town)return;
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(serializeTown(town)));
    if(revision!==hashRevision)return;
    currentHash=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');paint();
  }};
}
