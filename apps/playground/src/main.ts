import { deserializeTown, serializeTown } from '@settlement/core';
import { GenerationTask } from './generation-task';
import type { TownData, GenerateOptions, FeatureChoice, Bounds } from '@settlement/core';
import { buildMapScene, fitViewport, THEMES } from '@settlement/map-scene';
import type { MapScene, Viewport } from '@settlement/map-scene';
import { rendererFactories, isRendererKind, exportSceneImage, download } from './renderers';
import type { RendererKind } from './renderers';
import { bitmapTitle } from './bitmap-title';
import { populateThemes } from './theme-select';
import { districtLabels as labels, renderDistrictLegend } from './district-legend';
import './style.css';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const host = $('map'), form = $<HTMLFormElement>('generator'), error = $('error'), status = $('status');
const seed = $<HTMLInputElement>('seed'), size = $<HTMLSelectElement>('size'), theme = $<HTMLSelectElement>('theme');
populateThemes(theme);
const file = $<HTMLInputElement>('file'), tooltip = $('tooltip');
const params = new URLSearchParams(location.search);
const districtColors = $<HTMLInputElement>('district-colors');
districtColors.checked = params.get('districts') !== 'false';
if (params.get('capture') === '1') document.body.dataset.capture = 'true';
let rendererKind: RendererKind = isRendererKind(params.get('renderer')) ? params.get('renderer') as RendererKind : 'canvas';
let renderer = rendererFactories[rendererKind](host), town: TownData | null = null, scene: MapScene | null = null;
$<HTMLSelectElement>('renderer').value = rendererKind;
let viewport: Viewport = { centerX: 0, centerY: 0, zoom: 1 }, baseZoom = 1, generationCount = 0, revision = 0;
let width = 1, height = 1;
let autoFit = true;
const generation = new GenerationTask();
let generationRequest = 0;
function palette() { return THEMES[theme.value as keyof typeof THEMES]; }
function notifyError(message: string) { error.hidden = false; error.textContent = message; status.textContent = '操作未完成，请检查提示'; }
function options(): GenerateOptions {
  const feature = (id: string): FeatureChoice => { const value = $<HTMLSelectElement>(id).value; return value === 'auto' ? value : value === 'true'; };
  return { seed: Number(seed.value), size: Number(size.value), plaza: feature('plaza'), castle: feature('castle'), walls: feature('walls'), ...($<HTMLSelectElement>('river').value === 'true' ? { river: true } : {}) };
}
function setFields(value: GenerateOptions): void {
  seed.value = String(value.seed);
  $<HTMLSelectElement>('river').value = String(value.river ?? false);
  if (!Array.from(size.options).some(o => o.value === String(value.size))) size.add(new Option(`自定规模 · ${value.size}`, String(value.size)));
  size.value = String(value.size);
  for (const key of ['plaza', 'castle', 'walls'] as const) $<HTMLSelectElement>(key).value = String(value[key] ?? 'auto');
}
function syncURL(): void {
  if (!town) return;
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(town.request)) url.searchParams.set(key, String(value));
  url.searchParams.set('theme', theme.value);
  url.searchParams.set('river', String(town.request.river ?? false));
  url.searchParams.set('districts', String(districtColors.checked));
  url.searchParams.set('renderer',rendererKind); history.replaceState(null,'',url);
}
function cityBounds(): Bounds {
  if (!town) return { minX: -100, minY: -100, maxX: 100, maxY: 100 };
  const ids = new Set(town.districts.filter(d => d.withinCity).flatMap(d => d.boundary));
  const vertices = town.vertices.filter(v => ids.has(v.id));
  return vertices.length ? { minX: Math.min(...vertices.map(v => v.x)), minY: Math.min(...vertices.map(v => v.y)), maxX: Math.max(...vertices.map(v => v.x)), maxY: Math.max(...vertices.map(v => v.y)) } : town.bounds;
}
function updateViewport(value: Viewport): void {
  autoFit = false;
  viewport = value; renderer.setViewport(viewport); $('zoom-label').textContent = `${Math.round(viewport.zoom / baseZoom * 100)}%`; tooltip.hidden = true;
}
function fit(): void { const fitted = fitViewport(cityBounds(), width, height, Math.min(width, height) * 0.13); baseZoom = fitted.zoom; updateViewport(fitted); autoFit = true; }
function drawTheme(): void {
  if (!town) return;
  const nextScene = buildMapScene(town, palette(), { districtColors: districtColors.checked }); renderer.render(nextScene); scene = nextScene;
  renderDistrictLegend($('district-keys'), town, palette(), districtColors.checked);
  const labelColor = palette().label ?? palette().dark;
  document.querySelector<HTMLElement>('.map-caption')!.style.color = labelColor;
  document.querySelector<HTMLElement>('.compass')!.style.color = labelColor;
  void bitmapTitle($<HTMLCanvasElement>('atlas-title'), `SETTLEMENT / ${town.resolved.seed}`, labelColor).catch(() => { status.textContent = '地图已就绪，图名字体加载失败'; });
}
function present(next: TownData, source: 'generated' | 'imported'): void {
  const nextScene = buildMapScene(next, palette(), { districtColors: districtColors.checked });
  renderer.render(nextScene); town = next; scene = nextScene; revision++; setFields(next.request);
  error.hidden = true; tooltip.hidden = true; $<HTMLButtonElement>('export').disabled = false;
  $<HTMLButtonElement>('export-image').disabled = false; $<HTMLButtonElement>('export-svg').disabled = false;
  $('district-count').textContent = String(next.districts.filter(d => d.withinCity).length);
  $('building-count').textContent = next.buildings.length.toLocaleString('en-US');
  $('map-title').replaceChildren(document.createTextNode('城镇图册 '), Object.assign(document.createElement('span'), { textContent: `№ ${next.resolved.seed}` }));
  $('resolved').textContent = [next.resolved.plaza ? '有广场' : '无广场', next.resolved.castle ? '有城堡' : '无城堡', next.resolved.walls ? '有城墙' : '无城墙', ...(next.river ? [`穿城河流 · ${next.river.bridges.length} 座桥`] : [])].join(' · ');
  status.textContent = source === 'imported' ? '已导入地图 · 原始几何已保留' : '地图已就绪';
  $('hover-label').textContent = '将指针移入地图，查看街区用途';
  fit(); syncURL(); drawTheme(); document.body.dataset.ready = 'true';
}
async function generate(value = options()): Promise<void> {
  const request = ++generationRequest;
  const fields = $<HTMLFieldSetElement>('parameters'); fields.disabled = true; status.textContent = '正在绘制城镇…';
  $('cancel').hidden = false;
  try {
    generationCount++; const result = await generation.run(value);
    if (request !== generationRequest) return;
    if (!result.ok) { notifyError(`无法生成地图：${result.error.message}（${result.error.code}）`); return; }
    present(result.town, 'generated');
  } catch (e) {
    if (request !== generationRequest) return;
    if (e instanceof DOMException && e.name === 'AbortError') status.textContent = '已取消生成';
    else notifyError(e instanceof Error ? e.message : String(e));
  } finally { if (request === generationRequest) { fields.disabled = false; $('cancel').hidden = true; } }
}
$('cancel').addEventListener('click', () => generation.cancel());
form.addEventListener('submit', event => { event.preventDefault(); void generate(); });
$('random').addEventListener('click', () => { const bytes = crypto.getRandomValues(new Uint32Array(1)); seed.value = String(bytes[0] % 2147483646 + 1); void generate(); });
theme.addEventListener('change', () => { try { drawTheme(); syncURL(); } catch (e) { notifyError(String(e)); } });
districtColors.addEventListener('change', () => { try { drawTheme(); syncURL(); } catch (e) { notifyError(String(e)); } });
$('renderer').addEventListener('change',()=>{
  const choice=$<HTMLSelectElement>('renderer').value;if(!isRendererKind(choice))return;
  renderer.dispose();rendererKind=choice;renderer=rendererFactories[choice](host);
  renderer.resize(width,height,Math.min(devicePixelRatio||1,8));if(scene)renderer.render(scene);renderer.setViewport(viewport);syncURL();
});
async function exportMap(format: 'png' | 'svg'): Promise<void> {
  if (!town || !scene) return;
  const filename = `settlement-${town.resolved.seed}.${format}`;
  try {
    const blob = await exportSceneImage(scene, { ...viewport }, width, height, Math.min(devicePixelRatio || 1, 8), format);
    download(blob, filename); status.textContent = `地图 ${format.toUpperCase()} 已导出`;
  } catch (e) { notifyError(String(e)); }
}
$('export-image').addEventListener('click', () => { void exportMap('png'); });
$('export-svg').addEventListener('click', () => { void exportMap('svg'); });
$('import').addEventListener('click', () => file.click());
file.addEventListener('change', async () => {
  const selected = file.files?.[0]; if (!selected) return;
  generation.cancel();
  try {
    if (selected.size > 64_000_000) throw new Error('地图文件超过 64 MB 上限');
    const loaded = deserializeTown(await selected.text()); present(loaded, 'imported');
  } catch (e) { notifyError(`导入失败：${e instanceof Error ? e.message : String(e)}`); }
  finally { file.value = ''; }
});
$('export').addEventListener('click', () => {
  if (!town) return;
  const url = URL.createObjectURL(new Blob([serializeTown(town) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `settlement-${town.resolved.seed}-${town.resolved.size}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); status.textContent = '地图 JSON 已导出';
});
function zoom(factor: number, x = width / 2, y = height / 2): void {
  const next = Math.max(baseZoom * 0.2, Math.min(baseZoom * 12, viewport.zoom * factor));
  updateViewport({ centerX: viewport.centerX + (x - width / 2) * (1 / viewport.zoom - 1 / next), centerY: viewport.centerY + (y - height / 2) * (1 / viewport.zoom - 1 / next), zoom: next });
}
$('zoom-in').addEventListener('click', () => zoom(1.25)); $('zoom-out').addEventListener('click', () => zoom(0.8)); $('fit').addEventListener('click', fit);
host.addEventListener('wheel', event => { event.preventDefault(); const rect = host.getBoundingClientRect(); zoom(Math.exp(-event.deltaY * 0.001), event.clientX - rect.left, event.clientY - rect.top); }, { passive: false });
let drag: { x: number; y: number; view: Viewport; id: number } | null = null;
host.addEventListener('pointerdown', event => { if (event.button !== 0) return; drag = { x: event.clientX, y: event.clientY, view: { ...viewport }, id: event.pointerId }; host.setPointerCapture(event.pointerId); host.classList.add('dragging'); tooltip.hidden = true; });
const stopDrag = () => { drag = null; host.classList.remove('dragging'); };
host.addEventListener('pointerup', stopDrag); host.addEventListener('pointercancel', stopDrag); host.addEventListener('lostpointercapture', stopDrag);
host.addEventListener('pointermove', event => {
  if (drag) { updateViewport({ centerX: drag.view.centerX - (event.clientX - drag.x) / viewport.zoom, centerY: drag.view.centerY - (event.clientY - drag.y) / viewport.zoom, zoom: viewport.zoom }); return; }
  const rect = host.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
  const id = renderer.pick(x, y), district = town?.districts.find(d => d.id === id);
  tooltip.hidden = !district;
  if (district) {
    const label = `${labels[district.wardType] ?? district.wardType} · ${district.withinCity ? '城区' : '城郊'}`;
    tooltip.textContent = label; tooltip.style.left = `${Math.max(8, Math.min(x + 14, width - tooltip.offsetWidth - 10))}px`; tooltip.style.top = `${Math.max(8, Math.min(y + 14, height - 42))}px`;
    $('hover-label').textContent = label;
  } else $('hover-label').textContent = '将指针移入地图，查看街区用途';
});
host.addEventListener('pointerleave', () => { tooltip.hidden = true; });
host.addEventListener('keydown', event => {
  const offset = 35 / viewport.zoom;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); updateViewport({ ...viewport, centerX: viewport.centerX + (event.key === 'ArrowLeft' ? -offset : event.key === 'ArrowRight' ? offset : 0), centerY: viewport.centerY + (event.key === 'ArrowUp' ? -offset : event.key === 'ArrowDown' ? offset : 0) }); }
  else if (event.key === '+' || event.key === '=') zoom(1.25); else if (event.key === '-') zoom(0.8); else if (event.key === '0') fit();
});
function resize(): void { width = Math.max(1, host.clientWidth); height = Math.max(1, host.clientHeight); renderer.resize(width, height, Math.min(window.devicePixelRatio || 1, 8)); if (autoFit && town) fit(); else updateViewport(viewport); }
const observer = new ResizeObserver(resize); observer.observe(host); window.addEventListener('resize', resize); resize();
window.addEventListener('pagehide', () => { generation.cancel(); observer.disconnect(); window.removeEventListener('resize', resize); renderer.dispose(); }, { once: true });

// Acceptance-only instrumentation: never enabled on a normal preview URL.
if (params.get('test') === '1') Object.defineProperty(window, '__playground', { value: {
  get town() { return town; }, get scene() { return scene; }, get viewport() { return viewport; }, get generationCount() { return generationCount; }, get revision() { return revision; },
  load(value: string) { present(deserializeTown(value), 'imported'); }, setViewport: updateViewport,
  generate, cancel: () => generation.cancel(),
  pick(x: number, y: number) { return renderer.pick(x, y); },
  resize(w: number, h: number, dpr: number) { width = w; height = h; renderer.resize(w, h, dpr); },
  remount() { renderer.dispose(); renderer.dispose(); renderer = rendererFactories[rendererKind](host); resize(); if (scene) renderer.render(scene); updateViewport(viewport); },
} });
const initial: GenerateOptions = { seed: Number(params.get('seed') ?? 12345), size: Number(params.get('size') ?? 24) };
for (const key of ['plaza', 'castle', 'walls'] as const) { const value = params.get(key); if (value !== null) initial[key] = (value === 'true' ? true : value === 'false' ? false : value) as FeatureChoice; }
if (params.has('maxAttempts')) initial.maxAttempts = Number(params.get('maxAttempts'));
if (params.has('river')) initial.river = (params.get('river') === 'true' ? true : params.get('river') === 'false' ? false : params.get('river')) as boolean;
if (params.has('theme') && Object.hasOwn(THEMES, params.get('theme')!)) theme.value = params.get('theme')!;
setFields(initial); void generate(initial);
