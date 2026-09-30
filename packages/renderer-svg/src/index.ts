import { pickScene, layoutMapLabels, labelFont, LABEL_FONT } from '@settlement/map-scene';
import type { MapScene, MapRenderer, Viewport } from '@settlement/map-scene';
export interface SVGRenderer extends MapRenderer { exportSVG(): string }
const namespace='http://www.w3.org/2000/svg';
export function createSVGRenderer(container: HTMLElement): SVGRenderer {
  const svg=document.createElementNS(namespace,'svg'),background=document.createElementNS(namespace,'rect'),group=document.createElementNS(namespace,'g'),labelGroup=document.createElementNS(namespace,'g');
  const measure = document.createElement('canvas').getContext('2d')!;
  labelGroup.setAttribute('data-map-labels', ''); labelGroup.style.pointerEvents = 'none';
  svg.style.display='block';svg.append(background,group,labelGroup);container.append(svg);
  let width=Math.max(1,container.clientWidth),height=Math.max(1,container.clientHeight),disposed=false;
  let scene:MapScene|null=null,viewport:Viewport={centerX:0,centerY:0,zoom:1};
  const alive=()=>{if(disposed)throw new Error('Renderer has been disposed');};
  function drawLabels(): void {
    labelGroup.replaceChildren(); if (!scene) return;
    for (const label of layoutMapLabels(scene, viewport, width, height, (text, size, kind) => { measure.font = labelFont(size, kind); return measure.measureText(text).width; })) {
      const g = document.createElementNS(namespace, 'g'), title = document.createElementNS(namespace, 'title');
      g.setAttribute('data-label-id', label.id); g.setAttribute('aria-label', label.text); title.textContent = label.text; g.append(title);
      g.setAttribute('font-family', LABEL_FONT); g.setAttribute('font-size', String(label.fontSize)); g.setAttribute('font-weight', label.kind === 'city' ? 'normal' : 'bold');
      g.setAttribute('text-anchor', 'middle'); g.setAttribute('stroke-linejoin', 'round');
      for (const outline of [true, false]) for (const glyph of label.glyphs) {
        const text = document.createElementNS(namespace, 'text'); text.textContent = glyph.text;
        text.setAttribute('transform', `translate(${glyph.x} ${glyph.y}) rotate(${glyph.angle * 180 / Math.PI})`);
        text.setAttribute('fill', outline ? 'none' : label.fill);
        if (outline) { text.setAttribute('stroke', label.halo); text.setAttribute('stroke-width', String(label.haloWidth * 2)); text.setAttribute('aria-hidden', 'true'); }
        g.append(text);
      }
      labelGroup.append(g);
    }
  }
  function position():void {group.setAttribute('transform',`translate(${width/2} ${height/2}) scale(${viewport.zoom}) translate(${-viewport.centerX} ${-viewport.centerY})`); drawLabels();}
  function resize(w:number,h:number,dpr:number):void {
    alive();if(![w,h,dpr].every(Number.isFinite)||w<=0||h<=0||dpr<=0||dpr>8)throw new Error('Invalid renderer size');
    width=w;height=h;svg.setAttribute('width',String(w));svg.setAttribute('height',String(h));svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
    background.setAttribute('width',String(w));background.setAttribute('height',String(h));position();
  }
  resize(width,height,1);
  return {
    render(value){
      alive();scene=value;background.setAttribute('fill',value.background);
      const fragment=document.createDocumentFragment();
      for(const command of value.commands){
        const node=document.createElementNS(namespace,command.kind==='circle'?'circle':'path');
        if(command.kind==='circle'){node.setAttribute('cx',String(command.center.x));node.setAttribute('cy',String(command.center.y));node.setAttribute('r',String(command.radius));}
        else {
          if(!command.points.length)continue;
          const start=command.kind==='polygon'?command.points.at(-1)!:command.points[0];
          node.setAttribute('d',`M ${start.x} ${start.y} `+(command.kind==='polygon'?command.points:command.points.slice(1)).map(p=>`L ${p.x} ${p.y}`).join(' ')+(command.kind==='polygon'?' Z':''));
        }
        node.setAttribute('fill','fill' in command&&command.fill?command.fill:'none');
        const stroke=command.stroke;
        if(stroke){node.setAttribute('stroke',stroke.color);node.setAttribute('stroke-width',String(stroke.width));node.setAttribute('stroke-linecap',stroke.cap);node.setAttribute('stroke-linejoin',stroke.join);node.setAttribute('stroke-miterlimit',String(stroke.miterLimit));if(stroke.units==='screen')node.setAttribute('vector-effect','non-scaling-stroke');}
        fragment.append(node);
      }
      group.replaceChildren(fragment); drawLabels();
    },
    setViewport(value){alive();if(![value.centerX,value.centerY,value.zoom].every(Number.isFinite)||value.zoom<=0)throw new Error('Invalid viewport');viewport={...value};position();},
    resize,
    pick(x,y){alive();return pickScene(scene,viewport,width,height,x,y);},
    exportSVG(){alive();return '<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(svg);},
    dispose(){if(disposed)return;disposed=true;scene=null;svg.replaceChildren();svg.remove();},
  };
}
