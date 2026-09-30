import type { TownData } from '@settlement/core';
import { buildMapScene, fitViewport, THEMES } from '@settlement/map-scene';
import type { MapRenderer, Viewport, MapScene } from '@settlement/map-scene';
import { rendererFactories, isRendererKind, exportImage, download } from './renderers';
import type { RendererKind } from './renderers';
import small from '../../../tests/fixtures/p5/town-1-6.json';
import medium from '../../../tests/fixtures/p5/town-42-15.json';
import large from '../../../tests/fixtures/p5/town-12345-40.json';
import citadel from '../../../tests/fixtures/p5/town-citadel.json';
import dense from '../../../tests/fixtures/p5/town-dense.json';
import village from '../../../tests/fixtures/p5/town-village.json';
import './compare.css';
const samples={small,medium,large,citadel,dense,village} as unknown as Record<string,TownData>;
const query=new URLSearchParams(location.search),bench=query.get('bench');
if(isRendererKind(bench))document.body.dataset.bench=bench;
const kinds=(Object.keys(rendererFactories) as RendererKind[]).filter(kind=>!isRendererKind(bench)||kind===bench);
for(const article of Array.from(document.querySelectorAll<HTMLElement>('article')))article.hidden=!kinds.includes(article.dataset.kind as RendererKind);
const sample=document.querySelector<HTMLSelectElement>('#sample')!,theme=document.querySelector<HTMLSelectElement>('#theme')!,scale=document.querySelector<HTMLSelectElement>('#scale')!;
const renderers=new Map<RendererKind,MapRenderer>(),views=new Map<RendererKind,Viewport>();
let town=samples.medium,scene:MapScene,offset={x:0,y:0},zoom=1;
let differenceRevision=0;
const detail=document.querySelector<HTMLSelectElement>('#detail')!,difference=document.querySelector<HTMLButtonElement>('#difference')!;
if(Object.hasOwn(samples,query.get('sample')??''))sample.value=query.get('sample')!;
for(const select of [theme,scale,detail])if(Array.from(select.options).some(option=>option.value===query.get(select.id)))select.value=query.get(select.id)!;
function clearDifference():void {differenceRevision++;document.querySelectorAll('.difference-layer').forEach(el=>el.remove());difference.setAttribute('aria-pressed','false');difference.textContent='显示边缘差异';document.querySelector<HTMLElement>('#difference-note')!.hidden=true;}
const host=(kind:RendererKind)=>document.getElementById(kind)!;
function baseView(kind:RendererKind):Viewport{
  const ids=new Set(town.districts.filter(d=>d.withinCity).flatMap(d=>d.boundary)),points=town.vertices.filter(v=>ids.has(v.id));
  const bounds={minX:Math.min(...points.map(v=>v.x)),minY:Math.min(...points.map(v=>v.y)),maxX:Math.max(...points.map(v=>v.x)),maxY:Math.max(...points.map(v=>v.y))};
  return fitViewport(bounds,host(kind).clientWidth,host(kind).clientHeight,host(kind).clientWidth*.12);
}
function view():void {clearDifference();for(const [kind,renderer]of renderers){const base=baseView(kind),v={centerX:base.centerX+offset.x,centerY:base.centerY+offset.y,zoom:base.zoom*zoom};views.set(kind,v);renderer.setViewport(v);}}
function mount():void {for(const kind of kinds){const renderer=rendererFactories[kind](host(kind));renderers.set(kind,renderer);renderer.resize(host(kind).clientWidth,host(kind).clientHeight,devicePixelRatio);renderer.render(scene);}view();}
function load(name=sample.value):void {town=samples[name];scene=buildMapScene(town,THEMES[theme.value as keyof typeof THEMES]);offset={x:0,y:0};zoom=Number(scale.value);for(const renderer of renderers.values())renderer.render(scene);view();document.querySelector('#details')!.textContent=`种子 ${town.resolved.seed} · ${town.buildings.length} 栋建筑 · 共享 ${scene.commands.length} 条绘制指令`;}
load();mount();if(detail.value!=='whole')focusDetail();
function focusDetail():void {
  const vertices=new Map(town.vertices.map(v=>[v.id,v]));let p;
  if(detail.value==='towers')p=vertices.get(town.walls.find(w=>w.kind==='castle')?.towerVertexIds[0]??town.walls[0]?.towerVertexIds[0]);
  if(detail.value==='roads')p=vertices.get(town.roads.find(r=>r.kind==='external')?.vertexIds[0]??town.roads[0]?.vertexIds[0]);
  if(detail.value==='buildings'||(!p&&detail.value!=='whole')){const b=town.buildings.find(b=>town.districts.some(d=>d.id===b.districtId&&d.withinCity));if(b)p=vertices.get(b.boundary[0]);}
  if(p){const base=baseView(kinds[0]);offset={x:p.x-base.centerX,y:p.y-base.centerY};zoom=8;scale.value='8';}else{offset={x:0,y:0};zoom=1;scale.value='1';}view();
}
sample.onchange=()=>{load();focusDetail();};theme.onchange=()=>{scene=buildMapScene(town,THEMES[theme.value as keyof typeof THEMES]);for(const renderer of renderers.values())renderer.render(scene);view();};detail.onchange=focusDetail;scale.onchange=()=>{zoom=Number(scale.value);view();};document.querySelector<HTMLButtonElement>('#reset')!.onclick=()=>{detail.value='whole';focusDetail();};
difference.onclick=async()=>{
  if(difference.getAttribute('aria-pressed')==='true'){clearDifference();return;}
  const revision=++differenceRevision;difference.disabled=true;
  try{
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    const pixels:Partial<Record<RendererKind,ImageData>>={};
    for(const kind of kinds){
      const element=host(kind),canvas=document.createElement('canvas');canvas.width=Math.round(element.clientWidth*devicePixelRatio);canvas.height=Math.round(element.clientHeight*devicePixelRatio);const ctx=canvas.getContext('2d')!;
      if(kind==='svg'){
        const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(element.querySelector('svg')!)],{type:'image/svg+xml'}));
        try{const image=new Image();image.src=url;await image.decode();ctx.drawImage(image,0,0,canvas.width,canvas.height);}finally{URL.revokeObjectURL(url);}
      }else ctx.drawImage(element.querySelector('canvas')!,0,0,canvas.width,canvas.height);
      pixels[kind]=ctx.getImageData(0,0,canvas.width,canvas.height);
    }
    if(revision!==differenceRevision||!pixels.openfl)return;
    for(const kind of ['canvas','svg'] as const){const data=pixels[kind];if(!data)continue;const canvas=document.createElement('canvas');canvas.className='difference-layer';canvas.width=data.width;canvas.height=data.height;const ctx=canvas.getContext('2d')!,out=ctx.createImageData(data.width,data.height);let changed=0;
      for(let i=0;i<data.data.length;i+=4){let delta=0;for(let c=0;c<3;c++)delta=Math.max(delta,Math.abs(data.data[i+c]-pixels.openfl.data[i+c]));if(delta>16)changed++;const strength=Math.min(255,delta*8);out.data[i]=255;out.data[i+1]=255-strength;out.data[i+2]=255-strength;out.data[i+3]=255;}
      ctx.putImageData(out,0,0);host(kind).append(canvas);host(kind).parentElement!.querySelector('output')!.textContent=`通道差异 >16/255 的像素：${(100*changed/(data.width*data.height)).toFixed(2)}%`;
    }
    difference.setAttribute('aria-pressed','true');difference.textContent='返回原图';document.querySelector<HTMLElement>('#difference-note')!.hidden=false;
  }finally{difference.disabled=false;}
};
for(const kind of kinds){
  const element=host(kind);let drag:{x:number;y:number;offset:{x:number;y:number}}|null=null;
  element.onwheel=event=>{event.preventDefault();zoom=Math.max(.2,Math.min(8,zoom*Math.exp(-event.deltaY*.001)));view();};
  element.onpointerdown=event=>{if(event.button!==0)return;drag={x:event.clientX,y:event.clientY,offset:{...offset}};element.setPointerCapture(event.pointerId);};
  element.onpointerup=element.onpointercancel=element.onlostpointercapture=()=>{drag=null;};
  element.onpointermove=event=>{
    const v=views.get(kind)!;if(drag){offset={x:drag.offset.x-(event.clientX-drag.x)/v.zoom,y:drag.offset.y-(event.clientY-drag.y)/v.zoom};view();}
    const rect=element.getBoundingClientRect(),id=renderers.get(kind)!.pick(event.clientX-rect.left,event.clientY-rect.top);
    for(const other of kinds)host(other).parentElement!.querySelector('output')!.textContent=id?`${id} · ${town.districts.find(d=>d.id===id)?.wardType}`:'城镇之外';
  };
  element.parentElement!.querySelector('button')!.onclick=()=>{void exportImage(element,kind).then(blob=>download(blob,`comparison-${kind}-${town.resolved.seed}.${kind==='svg'?'svg':'png'}`));};
}
const observer=new ResizeObserver(()=>{for(const[kind,renderer]of renderers)renderer.resize(host(kind).clientWidth,host(kind).clientHeight,devicePixelRatio);view();});for(const kind of kinds)observer.observe(host(kind));
function dispose():void {for(const renderer of renderers.values())renderer.dispose();renderers.clear();}
window.addEventListener('pagehide',()=>{observer.disconnect();dispose();},{once:true});
if(query.get('test')==='1')Object.defineProperty(window,'__comparison',{value:{
  get town(){return town;},get scene(){return scene;},get views(){return Object.fromEntries(views);},
  load(name:string){sample.value=name;load(name);},zoom(value:number){zoom=value;view();},dispose,mount,
  redraw(){for(const renderer of renderers.values())renderer.render(scene);},
  pan(value:number){offset.x=value;view();},
  pick(kind:RendererKind,x:number,y:number){return renderers.get(kind)!.pick(x,y);},
  synthetic(value:MapScene){scene=value;for(const renderer of renderers.values())renderer.render(scene);},
  viewport(value:Viewport){for(const renderer of renderers.values())renderer.setViewport(value);},
  resize(w:number,h:number,dpr:number){for(const renderer of renderers.values())renderer.resize(w,h,dpr);},
}});
document.body.dataset.ready='true';
