import { generateTown } from '@settlement/core';
import { buildMapScene, fitViewport, THEMES } from '@settlement/map-scene';
import { createOpenFLRenderer } from '@settlement/renderer-openfl';
import type { MapRenderer } from '@settlement/renderer-openfl';
const result = generateTown({ seed: 42, size: 15 });
if (!result.ok) throw new Error(JSON.stringify(result.error));
export const town = result.town;
const scene = buildMapScene(town, THEMES.parchment);
const host = document.querySelector<HTMLDivElement>('#map')!;
let renderer: MapRenderer | null = null;
export function mount(): void {
  dispose(); renderer = createOpenFLRenderer(host);
  renderer.resize(host.clientWidth, host.clientHeight, devicePixelRatio);
  renderer.render(scene);
  renderer.setViewport(fitViewport(town.bounds,host.clientWidth,host.clientHeight));
}
export function dispose(): void { renderer?.dispose(); renderer?.dispose(); renderer = null; }
export function redraw(): void { renderer?.render(scene); }
export function centerHit(): string | null { return renderer?.pick(host.clientWidth/2,host.clientHeight/2) ?? null; }
window.addEventListener('pagehide',dispose,{once:true});
mount(); document.querySelector('#status')!.textContent = `地图就绪 · ${town.generatorVersion} · ${town.buildings.length} 栋建筑`;
