import { pointInRing } from '@settlement/map-scene';
import type { MapScene, Viewport, DrawCommand, MapRenderer } from '@settlement/map-scene';
export type { MapRenderer } from '@settlement/map-scene';
import type Graphics from 'openfl/lib/openfl/display/Graphics';
import { Stage, Sprite, CapsStyle, JointStyle, LineScaleMode } from './openfl.js';
import { disposeRuntime, prepareShaderCache, ownShaderCache } from './runtime.js';
const color = (value: string): number => parseInt(value.slice(1), 16);
export function createOpenFLRenderer(container: HTMLElement): MapRenderer {
  const mount = document.createElement('div'); mount.style.cssText = 'width:100%;height:100%;overflow:hidden'; container.append(mount);
  prepareShaderCache();
  const stage = new Stage(0, 0, 0xccc5b8, undefined, { element: mount, renderer: 'webgl2', allowHighDPI: true, context: { antialiasing: 4, preserveDrawingBuffer: true } });
  const releaseShaders = ownShaderCache();
  const sprite = new Sprite(); sprite.mouseEnabled = false; stage.addChild(sprite);
  let scene: MapScene | null = null, viewport: Viewport = { centerX: 0, centerY: 0, zoom: 1 };
  let width = container.clientWidth, height = container.clientHeight, disposed = false;
  const alive = () => { if (disposed) throw new Error('Renderer has been disposed'); };
  function draw(g: Graphics, command: DrawCommand): void {
    const s = command.stroke;
    if (s) g.lineStyle(s.units === 'screen' ? s.width / viewport.zoom : s.width, color(s.color), 1, false, LineScaleMode.NORMAL,
      s.cap === 'butt' ? CapsStyle.NONE : s.cap === 'square' ? CapsStyle.SQUARE : CapsStyle.ROUND,
      s.join === 'miter' ? JointStyle.MITER : s.join === 'bevel' ? JointStyle.BEVEL : JointStyle.ROUND, s.miterLimit);
    else g.lineStyle();
    if ('fill' in command && command.fill) g.beginFill(color(command.fill));
    if (command.kind === 'circle') g.drawCircle(command.center.x, command.center.y, command.radius);
    else if (command.points.length) {
      // Legacy polygons begin at the last vertex, preserving closure joins.
      const start = command.kind === 'polygon' ? command.points.at(-1)! : command.points[0];
      g.moveTo(start.x, start.y);
      for (const p of command.kind === 'polygon' ? command.points : command.points.slice(1)) g.lineTo(p.x, p.y);
    }
    g.endFill();
  }
  function paint(): void { sprite.graphics.clear(); if (scene) for (const command of scene.commands) draw(sprite.graphics, command); }
  function position(): void { sprite.scaleX = sprite.scaleY = viewport.zoom; sprite.x = width / 2 - viewport.centerX * viewport.zoom; sprite.y = height / 2 - viewport.centerY * viewport.zoom; }
  const api: MapRenderer = {
    render(value) { alive(); scene = value; stage.color = color(value.background); paint(); position(); },
    setViewport(value) {
      alive(); if (![value.centerX, value.centerY, value.zoom].every(Number.isFinite) || value.zoom <= 0) throw new Error('Invalid viewport');
      const redraw = viewport.zoom !== value.zoom && scene?.commands.some(c => c.stroke?.units === 'screen');
      viewport = { ...value }; position(); if (redraw) paint();
    },
    resize(w, h, dpr) {
      alive(); if (![w, h, dpr].every(Number.isFinite) || w <= 0 || h <= 0 || dpr <= 0 || dpr > 8) throw new Error('Invalid renderer size');
      width = w; height = h; mount.style.width = `${w}px`; mount.style.height = `${h}px`;
      // Pinned OpenFL 9.5.2 caches DPR at construction. Keep its backing-store,
      // window scale and Stage transform synchronized when a monitor changes.
      const win = stage.window, backend = win.__backend;
      backend.scale = dpr; win.__scale = dpr;
      backend.updateSize();
      const canvas = mount.querySelector('canvas')!;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
        win.onResize.dispatch(w, h);
      }
      position();
    },
    pick(x, y) {
      alive(); if (!scene || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > width || y > height) return null;
      const p = { x: viewport.centerX + (x - width / 2) / viewport.zoom, y: viewport.centerY + (y - height / 2) / viewport.zoom };
      for (let i = scene.hitRegions.length - 1; i >= 0; i--) if (pointInRing(scene.hitRegions[i].points, p)) return scene.hitRegions[i].entityId;
      return null;
    },
    dispose() {
      if (disposed) return; disposed = true; scene = null; sprite.graphics.clear(); stage.removeChild(sprite);
      const canvas = mount.querySelector('canvas'), gl = canvas?.getContext('webgl2');
      disposeRuntime(stage); releaseShaders(); gl?.getExtension('WEBGL_lose_context')?.loseContext(); mount.remove();
    },
  };
  return api;
}
