import { deserializeTown, serializeTown, type TownData } from '@settlement/core';
import { createRiverViewer, type Framing, type RiverScene, type ReferenceCamera } from '@settlement/renderer-three';
import { riverSupportError } from '../../shared/three-d-support.mjs';
import snapshotUrl from './assets/river-town.json?url';
import referenceUrl from './assets/blender-reference.png';
import fountain from './assets/fountain_basin_01.glb?url';
import oak from './assets/tree_oak_01.glb?url';
import joinery from './assets/kits/joinery.glb?url';
import church from './assets/kits/church.glb?url';
import castle from './assets/kits/castle.glb?url';
import market from './assets/kits/market.glb?url';
import harbor from './assets/kits/harbor.glb?url';
import estuary from './assets/estuary.json?url';
import riverPort from './assets/river-port.json?url';
import estuaryImage from './assets/estuary-reference.webp';
import riverPortImage from './assets/river-port-reference.webp';
import './studio.css';

const samples=[
  {id:'sample',label:'石拱桥 · Alderford',source:snapshotUrl,image:referenceUrl,seed:7,count:170,
    camera:[-260.8981628417969,-272.9185485839844,405.22662353515625],span:261.4014587402344},
  {id:'river-port',label:'城堡河港 · Mistmere',source:riverPort,image:riverPortImage,seed:1246393668,count:101,
    camera:[-223.68560791015625,-281.18280029296875,423.657470703125],span:227.03257751464844},
  {id:'estuary',label:'河口海港 · Alderford',source:estuary,image:estuaryImage,seed:7,count:433,
    camera:[-251.84820556640625,-276.2086486816406,408.8938293457031],span:374.34576416015625},
];
type Sample=typeof samples[number];
const cache=new Map<string,Promise<TownData>>();
function getBaseline(sample:Sample) {
  const pending=cache.get(sample.id);
  if(pending) return pending;
  const data=fetch(sample.source).then(async response => {
    if (!response.ok) throw new Error('河城样本加载失败，请重试。');
    return deserializeTown(await response.text());
  }).catch(err => { cache.delete(sample.id); throw err; });
  cache.set(sample.id,data); return data;
}
function matchingCamera(town: TownData,sample:Sample): ReferenceCamera {
  const [x, y, z] = sample.camera;
  const az = 225 * Math.PI / 180, el = 48 * Math.PI / 180;
  return { position: [x - town.center.x * .5, z, -(y - town.center.y * .5)],
    direction: [Math.cos(az) * Math.cos(el), Math.sin(el), -Math.sin(az) * Math.cos(el)], span: sample.span };
}
const icons = {
  back: '<path d="m13 5-7 7 7 7M6 12h14"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4"/>',
  split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  orbit: '<ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-24 12 12)"/><circle cx="12" cy="12" r="2"/>',
};
const icon = (name: keyof typeof icons) => '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + icons[name] + '</svg>';

type StudioContext = { town: TownData; sidebar: HTMLElement } | { onBack: (source:string) => void };

export function mountRiverStudio(root: HTMLElement, context: StudioContext) {
  const embedded='town' in context;
  const current=embedded ? context.town : null;
  const controls=embedded ? context.sidebar : root;
  const frameButtons = '<button data-frame="full" title="让整座城镇适应画布">全城</button><button data-frame="start">初始机位</button><button data-frame="street">街屋</button><button data-frame="road">道路转弯</button><button data-frame="gate">城门</button><button data-frame="church">教堂</button><button data-frame="castle">主堡</button><button data-frame="market">集市</button><button data-frame="harbor">码头</button><button data-frame="bridge">桥头</button>';
  const actions = `<button type="button" data-ui="compare" aria-pressed="false">${icon('split')}<span>对照样片</span></button><select aria-label="导出长边" data-ui="size"><option value="1500">1500 px</option><option value="3200">3200 px</option></select><button type="button" data-ui="save" class="river-primary" disabled>${icon('download')}<span>导出 PNG</span></button>`;
  root.classList.add('river-studio');
  const standaloneHeader = `
    <header class="river-head"><div class="river-title"><button class="river-back" aria-label="返回地图工坊" data-ui="back">${icon('back')}</button><div><p>城镇地图工坊</p><h1>河城漫游</h1></div></div>
      <div class="river-actions">${actions}</div></header>
    <div class="river-tools"><div class="river-source"><label for="river-source">规划</label><select id="river-source" data-ui="source"></select></div>
      <div class="river-frames" aria-label="相机取景">${frameButtons}</div></div>`;
  if (embedded) {
    controls.innerHTML=`<fieldset class="live-camera"><legend>相机取景</legend><div class="live-frames">${frameButtons}</div></fieldset>
      <fieldset class="live-export"><legend>图片导出</legend>${actions}</fieldset>`;
  }
  root.innerHTML = (embedded ? '' : standaloneHeader) + `
    <div class="river-workspace" data-ui="space">
      <section class="river-pane" aria-label="实时模型"><div class="river-caption"><strong><i></i>Three.js</strong><span>实时模型</span></div><div class="river-mat"><div class="river-frame" data-ui="canvas"></div></div></section>
      <section class="river-pane river-reference" data-ui="reference" aria-label="Blender 参考图片" hidden><div class="river-caption"><strong>Blender</strong><span>固定机位 · <a data-ui="original" target="_blank" rel="noopener">查看原图 ↗</a></span></div><div class="river-mat"><img data-ui="image" alt="同一份城镇规划在 Blender 中的线稿淡彩轴测图"></div></section>
    </div>
    <div class="river-notice" data-ui="notice" role="status" aria-live="polite" hidden><span data-ui="message"></span><button data-ui="retry" hidden>重试</button><button data-ui="sample" hidden>打开石拱桥样本</button></div>
    <footer class="river-foot"><span data-ui="stats"></span><span>${icon('orbit')}双击建筑看近景 · 拖动旋转 · 滚轮或双指缩放</span></footer>`;
  const el = <T extends HTMLElement = HTMLElement>(key: string) => (root.querySelector<T>('[data-ui="' + key + '"]') ?? controls.querySelector<T>('[data-ui="' + key + '"]'))!;
  const source = root.querySelector<HTMLSelectElement>('[data-ui=source]'), compare = el<HTMLButtonElement>('compare'), save = el<HTMLButtonElement>('save');
  const frames = Array.from(controls.querySelectorAll<HTMLButtonElement>('[data-frame]'));
  const host = el('canvas'), image = el<HTMLImageElement>('image');
  el<HTMLAnchorElement>('original').href = referenceUrl;
  let activeTown: TownData | null = null, viewer: ReturnType<typeof createRiverViewer> | null = null, worker: Worker | null = null;
  const query=new URLSearchParams(location.search);
  let initialFrame=query.get('focus');
  let revision = 0, disposed = false, canCompare = false, wantCompare = !embedded && window.innerWidth >= 820 && !initialFrame;
  let reference:Sample|null=null;
  if (source) {
    for(const sample of samples) source.add(new Option(sample.label,sample.id));
    source.value=samples.find(s=>s.id===query.get('sample'))?.id??'sample';
  }
  function notice(message: string, retry = false, sample = false) {
    el('message').textContent = message; el('notice').hidden = !message;
    el('retry').hidden = !retry; el('sample').hidden = embedded || !sample;
  }
  function compareLayout() {
    const paired = canCompare && wantCompare;
    compare.disabled = !canCompare; compare.title = canCompare ? '同一规划的固定 Blender 样片' : '当前规划没有配套 Blender 样片';
    compare.hidden=embedded && !canCompare;
    compare.setAttribute('aria-pressed', String(paired));
    el('reference').hidden = !paired; el('space').classList.toggle('paired', paired);
    if (reference) {
      el<HTMLAnchorElement>('original').href=reference.image;
      if(paired && image.getAttribute('src')!==reference.image) image.src=reference.image;
    }
  }
  function stop() {
    worker?.terminate(); worker = null; viewer?.dispose(); viewer = null;
    save.disabled = true; frames.forEach(b => b.disabled = true);
    host.replaceChildren(); delete root.dataset.ready; delete root.dataset.details;
  }
  async function load() {
    const token = ++revision;
    stop(); activeTown = null; canCompare = false; compareLayout();
    notice('正在读取规划…'); el('stats').textContent = '';
    try {
      const selected=source ? samples.find(s=>s.id===source.value) : undefined;
      const town = current ?? await getBaseline(selected??samples[0]);
      if (disposed || token !== revision) return;
      const why = riverSupportError(town);
      if (why) { notice(why, false, true); return; }
      activeTown = town;
      // Imported copies get the reference only when the actual planning data match.
      const candidate=selected??samples.find(s=>s.seed===town.resolved.seed && s.count===town.buildings.length);
      const sample = selected ? town : candidate ? await getBaseline(candidate).catch(()=>null) : null;
      if (disposed || token !== revision) return;
      canCompare = town === sample || (!!sample && serializeTown(town) === serializeTown(sample));
      reference=canCompare && candidate?candidate:null;
      compareLayout();
      el('stats').textContent = (town.atlas?.cityName ?? '城镇') + '　·　' + town.buildings.length + ' 栋建筑　' + town.roads.length + ' 条道路　' + (town.river?.bridges.length??0) + ' 座桥';
      notice('正在组装城镇街区…');
      const task = new Worker(new URL('./assembly.worker.ts', import.meta.url), { type: 'module' }); worker = task;
      const fail = (message: string) => {
        if (disposed || token !== revision) return;
        stop(); notice(message, true);
      };
      task.onerror = event => fail('城镇组装失败。' + event.message);
      task.onmessage = (event: MessageEvent<{ scene?: RiverScene; error?: string }>) => {
        if (disposed || token !== revision) return;
        task.terminate(); worker = null;
        if (!event.data.scene) { fail(event.data.error || '城镇组装失败'); return; }
        try {
          const scene=event.data.scene;
          const gateCount = Object.keys(scene.gates).length;
          if (gateCount) el('stats').append('　' + gateCount + ' 座城门');
          viewer = createRiverViewer(host, scene, reference ? matchingCamera(town,reference) : null, { oak, fountain, joinery,church,castle,market,harbor },
            msg => { if (revision === token && !disposed) notice(msg); });
          frames.forEach(button => {
            const key=button.dataset.frame!;
            button.hidden=!(key==='start' || key==='full' || (key==='bridge' && town.river?.bridges.length) || key in scene.focus);
            button.disabled=button.hidden;
          });
          if(initialFrame && frames.some(b=>!b.hidden && b.dataset.frame===initialFrame)) viewer.setView(initialFrame as Framing);
          else {
            const atJunction = initialFrame?.startsWith('junction/') && viewer.inspectJunction(initialFrame.slice('junction/'.length));
            if (embedded && !atJunction) viewer.setView('full');
          }
          initialFrame=null;
          void viewer.assetsReady.then(()=>{if(revision===token && !disposed) {root.dataset.details='ready'; save.disabled=false;}}).catch(()=>{
            if(revision===token && !disposed) notice('建筑素材加载失败，可重试加载。',true);
          });
          notice(''); root.dataset.ready = 'true';
        } catch (err) {
          fail('无法打开实时画布。请检查浏览器 WebGL 2 或图形加速设置。' + (err instanceof Error ? ' ' + err.message : ''));
        }
      };
      task.postMessage(town);
    } catch (err) { if (!disposed && token === revision) notice(err instanceof Error ? err.message : String(err), true); }
  }
  if (source && 'onBack' in context) {
    source.onchange = () => void load();
    el('sample').onclick = () => { source.value = 'sample'; void load(); };
    el('back').onclick = () => context.onBack(source.value);
  }
  el('retry').onclick = () => void load();
  image.onerror = () => notice('Blender 对照图加载失败。', true);
  el('retry').addEventListener('click', () => { if (image.complete && !image.naturalWidth) image.removeAttribute('src'); });
  compare.onclick = () => { wantCompare = !wantCompare; compareLayout(); if (wantCompare) viewer?.setView('start'); };
  for (const button of frames) button.onclick = () => viewer?.setView(button.dataset.frame as Framing);
  save.onclick = async () => {
    if (!viewer || !activeTown) return;
    const token = revision, town = activeTown;
    save.disabled = true;
    try {
      const longSide=Number(el<HTMLSelectElement>('size').value);
      const blob = await viewer.exportPNG(longSide);
      if (disposed || token !== revision) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = (embedded ? 'town-3d-' : 'river-') + town.resolved.seed + '-' + longSide + '.png'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) { if (!disposed && token === revision) notice(String(err)); }
    finally { if (!disposed && token === revision) save.disabled = false; }
  };
  void load();
  return () => { disposed = true; revision++; stop(); root.replaceChildren(); if(embedded) controls.replaceChildren(); };
}
