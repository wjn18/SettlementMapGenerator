import { createOpenFLRenderer } from '@settlement/renderer-openfl';
import { createCanvasRenderer } from '@settlement/renderer-canvas';
import { createSVGRenderer } from '@settlement/renderer-svg';
import type { MapScene, Viewport } from '@settlement/map-scene';
export const rendererFactories = { openfl: createOpenFLRenderer, canvas: createCanvasRenderer, svg: createSVGRenderer };
export type RendererKind = keyof typeof rendererFactories;
export const isRendererKind = (value: string | null): value is RendererKind => value !== null && Object.hasOwn(rendererFactories,value);
export async function exportSceneImage(scene: MapScene, viewport: Viewport, width: number, height: number, dpr: number, format: 'png' | 'svg'): Promise<Blob> {
  // An isolated renderer snapshots the scene without switching the live preview.
  const host = document.createElement('div');
  const renderer = format === 'svg' ? createSVGRenderer(host) : createCanvasRenderer(host);
  try {
    renderer.resize(width, height, dpr);
    renderer.setViewport(viewport);
    renderer.render(scene);
    if ('exportSVG' in renderer) return new Blob([renderer.exportSVG()], { type: 'image/svg+xml' });
    return await renderer.exportPNG();
  } finally { renderer.dispose(); }
}
export async function exportImage(host: HTMLElement, kind: RendererKind): Promise<Blob> {
  // Two frame boundaries allow OpenFL's scheduled render to catch up.
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
  if(kind==='svg'){
    const svg=host.querySelector('svg')!;
    return new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n',new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'});
  }
  return new Promise((resolve,reject)=>host.querySelector('canvas')!.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG 导出失败')),'image/png'));
}
export function download(blob: Blob, name: string): void {
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
