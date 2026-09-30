import {generateTown} from '@settlement/core';
import {buildMapScene,fitViewport} from '@settlement/map-scene';
import type {MapRenderer} from '@settlement/map-scene';
import {createCanvasRenderer} from '@settlement/renderer-canvas';
import {createSVGRenderer} from '@settlement/renderer-svg';
const result=generateTown({seed:42,size:15});if(!result.ok)throw new Error(result.error.message);
const scene=buildMapScene(result.town),host=document.querySelector<HTMLDivElement>('#map')!;
const factory=new URLSearchParams(location.search).get('renderer')==='svg'?createSVGRenderer:createCanvasRenderer;
let renderer:MapRenderer|null=null;
export function dispose():void{renderer?.dispose();renderer?.dispose();renderer=null;}
export function mount():void{dispose();renderer=factory(host);renderer.resize(host.clientWidth,host.clientHeight,devicePixelRatio);renderer.render(scene);renderer.setViewport(fitViewport(scene.bounds,host.clientWidth,host.clientHeight));}
export function redraw():void{renderer?.render(scene);}
window.addEventListener('pagehide',dispose,{once:true});mount();document.querySelector('#status')!.textContent='地图就绪';
