import { pickScene, layoutMapLabels, labelFont } from '@settlement/map-scene';
import type { MapScene, MapRenderer, Viewport } from '@settlement/map-scene';
export interface CanvasRenderer extends MapRenderer { exportPNG(): Promise<Blob> }
export function createCanvasRenderer(container: HTMLElement): CanvasRenderer {
  const canvas=document.createElement('canvas'), context=canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  const ctx=context; container.append(canvas);canvas.style.display='block';
  let width=Math.max(1,container.clientWidth),height=Math.max(1,container.clientHeight),dpr=1,disposed=false;
  let scene: MapScene|null=null,viewport: Viewport={centerX:0,centerY:0,zoom:1};
  const alive=()=>{if(disposed)throw new Error('Renderer has been disposed');};
  function paint(): void {
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
    if(!scene)return;
    ctx.fillStyle=scene.background;ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.setTransform(dpr*viewport.zoom,0,0,dpr*viewport.zoom,dpr*(width/2-viewport.centerX*viewport.zoom),dpr*(height/2-viewport.centerY*viewport.zoom));
    for(const command of scene.commands) {
      ctx.beginPath();
      if(command.kind==='circle')ctx.arc(command.center.x,command.center.y,command.radius,0,Math.PI*2);
      else {
        if(!command.points.length)continue;
        const start=command.kind==='polygon'?command.points.at(-1)!:command.points[0];ctx.moveTo(start.x,start.y);
        for(const p of command.kind==='polygon'?command.points:command.points.slice(1))ctx.lineTo(p.x,p.y);
        if(command.kind==='polygon')ctx.closePath();
      }
      if('fill' in command&&command.fill){ctx.fillStyle=command.fill;ctx.fill();}
      const stroke=command.stroke;
      if(stroke){ctx.strokeStyle=stroke.color;ctx.lineWidth=stroke.width/(stroke.units==='screen'?viewport.zoom:1);ctx.lineCap=stroke.cap;ctx.lineJoin=stroke.join;ctx.miterLimit=stroke.miterLimit;ctx.stroke();}
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const labels = layoutMapLabels(scene, viewport, width, height, (text, size, kind) => { ctx.font = labelFont(size, kind); return ctx.measureText(text).width; });
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
    for (const label of labels) {
      ctx.font = labelFont(label.fontSize, label.kind); ctx.fillStyle = label.fill; ctx.strokeStyle = label.halo; ctx.lineWidth = label.haloWidth * 2;
      for (const outline of [true, false]) for (const glyph of label.glyphs) {
        ctx.save(); ctx.translate(glyph.x, glyph.y); ctx.rotate(glyph.angle);
        if (outline) ctx.strokeText(glyph.text, 0, 0); else ctx.fillText(glyph.text, 0, 0);
        ctx.restore();
      }
    }
  }
  function resize(w:number,h:number,ratio:number):void {
    alive();if(![w,h,ratio].every(Number.isFinite)||w<=0||h<=0||ratio<=0||ratio>8)throw new Error('Invalid renderer size');
    width=w;height=h;dpr=ratio;canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);canvas.style.width=`${w}px`;canvas.style.height=`${h}px`;paint();
  }
  resize(width,height,1);
  return {
    render(value){alive();scene=value;paint();},
    setViewport(value){alive();if(![value.centerX,value.centerY,value.zoom].every(Number.isFinite)||value.zoom<=0)throw new Error('Invalid viewport');viewport={...value};paint();},
    resize,
    pick(x,y){alive();return pickScene(scene,viewport,width,height,x,y);},
    exportPNG(){alive();return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG encoding failed')),'image/png'));},
    dispose(){if(disposed)return;disposed=true;scene=null;canvas.remove();canvas.width=canvas.height=0;},
  };
}
