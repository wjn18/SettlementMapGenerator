import { pickScene, layoutMapLabels, labelFont } from '@settlement/map-scene';
import type { MapScene, Viewport, DrawCommand, MapRenderer } from '@settlement/map-scene';
export type { MapRenderer } from '@settlement/map-scene';
import type Graphics from 'openfl/lib/openfl/display/Graphics';
import { Stage, Sprite, CapsStyle, JointStyle, LineScaleMode, Bitmap, BitmapData } from './openfl.js';
import { disposeRuntime, prepareShaderCache, ownShaderCache } from './runtime.js';
const color = (value: string): number => parseInt(value.slice(1), 16);
export function createOpenFLRenderer(container: HTMLElement): MapRenderer {
  const mount = document.createElement('div'); mount.style.cssText = 'width:100%;height:100%;overflow:hidden;position:relative'; container.append(mount);
  prepareShaderCache();
  const stage = new Stage(0, 0, 0xccc5b8, undefined, { element: mount, renderer: 'webgl2', allowHighDPI: true, context: { antialiasing: 4, preserveDrawingBuffer: true } });
  const releaseShaders = ownShaderCache();
  const sprite = new Sprite(); sprite.mouseEnabled = false; stage.addChild(sprite);
  const labelCanvas = document.createElement('canvas'), labelContext = labelCanvas.getContext('2d')!;
  const labelBitmap = new Bitmap(); stage.addChild(labelBitmap);
  let scene: MapScene | null = null, viewport: Viewport = { centerX: 0, centerY: 0, zoom: 1 };
  let width = container.clientWidth, height = container.clientHeight, labelDpr = 1, disposed = false;
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
  function paintLabels(): void {
    labelBitmap.bitmapData?.dispose(); labelBitmap.bitmapData = null!;
    labelCanvas.width = Math.max(1, Math.round(width * labelDpr)); labelCanvas.height = Math.max(1, Math.round(height * labelDpr));
    const ctx = labelContext; ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,labelCanvas.width,labelCanvas.height); if (!scene?.labels?.length) return;
    ctx.setTransform(labelDpr,0,0,labelDpr,0,0); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
    for (const label of layoutMapLabels(scene, viewport, width, height, (text,size,kind) => { ctx.font = labelFont(size,kind); return ctx.measureText(text).width; })) {
      ctx.font = labelFont(label.fontSize,label.kind); ctx.fillStyle = label.fill; ctx.strokeStyle = label.halo; ctx.lineWidth = label.haloWidth * 2;
      for (const outline of [true,false]) for (const glyph of label.glyphs) { ctx.save(); ctx.translate(glyph.x,glyph.y); ctx.rotate(glyph.angle); if (outline) ctx.strokeText(glyph.text,0,0); else ctx.fillText(glyph.text,0,0); ctx.restore(); }
    }
    labelBitmap.bitmapData = BitmapData.fromCanvas(labelCanvas); labelBitmap.scaleX = labelBitmap.scaleY = 1 / labelDpr;
  }
  function position(): void { sprite.scaleX = sprite.scaleY = viewport.zoom; sprite.x = width / 2 - viewport.centerX * viewport.zoom; sprite.y = height / 2 - viewport.centerY * viewport.zoom; paintLabels(); }
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
      labelDpr = dpr; labelCanvas.width = Math.round(w*dpr); labelCanvas.height = Math.round(h*dpr); labelCanvas.style.width = `${w}px`; labelCanvas.style.height = `${h}px`;
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
      alive(); return pickScene(scene, viewport, width, height, x, y);
    },
    dispose() {
      if (disposed) return; disposed = true; scene = null; sprite.graphics.clear(); stage.removeChild(sprite);
      const canvas = mount.querySelector('canvas'), gl = canvas?.getContext('webgl2');
      labelBitmap.bitmapData?.dispose(); labelBitmap.bitmapData = null!;
      disposeRuntime(stage); releaseShaders(); gl?.getExtension('WEBGL_lose_context')?.loseContext(); mount.remove();
      labelCanvas.width = labelCanvas.height = 0;
    },
  };
  return api;
}
