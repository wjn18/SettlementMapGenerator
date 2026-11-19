import type { TownData } from '@settlement/core';
import { kitCatalog } from './kit-catalog.js';
import { at, point, strip, world, type XY, type XYZ } from './mesh.js';
import type { LocalRoads } from './landscape.js';

export type Kit = keyof typeof kitCatalog;
export type Library = (typeof kitCatalog)[Kit]['library'];
export interface Mount { kit: Kit; source: string; position: XYZ; yaw: number; scale: XYZ; detail: number }
export interface Focus { target: XYZ; direction: XYZ; span: number }
export type FocusName = 'street' | 'church' | 'castle' | 'market' | 'harbor' | 'gate' | 'road';
export function mount(kit: Kit, source: string, p: XY, h: number, yaw = 0, scale: XYZ = [1,1,1], detail = 0): Mount {
  return { kit, source, position: world(p,h), yaw, scale, detail };
}
export function fitKit(kit: Kit, w: number, h: number, d?: number): XYZ {
  const [x,y,z] = kitCatalog[kit].size;
  return [w/x, h/y, d === undefined ? Math.min(w/x,h/y) : d/z];
}
export const faceYaw = (n: XY) => Math.atan2(n.x, -n.y);
export const distanceToEdge = (p: XY, a: XY, b: XY) => {
  const x = b.x-a.x, y = b.y-a.y, d = x*x+y*y;
  const t = d ? Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/d)) : 0;
  return Math.hypot(p.x-a.x-x*t,p.y-a.y-y*t);
};
export function inRing(p: XY, ring: XY[]) {
  let inside = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i], b=ring[j];
    if ((a.y>p.y)!==(b.y>p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}
export const ringDistance = (p: XY, ring: XY[]) => Math.min(...ring.map((a,i)=>distanceToEdge(p,a,ring[(i+1)%ring.length])));
type Obstacle = { id: string; kind: 'building'|'road'|'wall'|'feature'|'decor'; ring: XY[] };
export class Occupancy {
  private cells = new Map<string, Obstacle[]>();
  add(id: string, kind: Obstacle['kind'], ring: XY[]) {
    if (!ring.length) return;
    const obstacle = {id,kind,ring};
    const xs=ring.map(p=>p.x), ys=ring.map(p=>p.y);
    for(let x=Math.floor(Math.min(...xs)/24);x<=Math.floor(Math.max(...xs)/24);x++)
      for(let y=Math.floor(Math.min(...ys)/24);y<=Math.floor(Math.max(...ys)/24);y++){
        const key=x+','+y;
        const cell=this.cells.get(key);
        if(cell) cell.push(obstacle); else this.cells.set(key,[obstacle]);
      }
  }
  nearby(p: XY, radius: number) {
    const found=new Set<Obstacle>();
    for(let x=Math.floor((p.x-radius)/24);x<=Math.floor((p.x+radius)/24);x++)
      for(let y=Math.floor((p.y-radius)/24);y<=Math.floor((p.y+radius)/24);y++)
        for(const o of this.cells.get(x+','+y)??[]) found.add(o);
    return found;
  }
  free(p: XY, radius: number, ignore = '') {
    for(const o of this.nearby(p,radius)) if(o.id!==ignore && (inRing(p,o.ring)||ringDistance(p,o.ring)<radius)) return false;
    return true;
  }
  streetDistance(p: XY) {
    let best=30;
    for(const o of this.nearby(p,best)) if(o.kind==='road') best=Math.min(best,inRing(p,o.ring)?0:ringDistance(p,o.ring));
    return best;
  }
}
export function indexTown(town: TownData, vertex: (id: string)=>XY, roads: LocalRoads) {
  const index=new Occupancy();
  for(const b of town.buildings) index.add(b.id,'building',b.boundary.map(vertex));
  for(const f of town.features) index.add(f.id,'feature',f.boundary.map(vertex));
  for(const {road,path,radius} of roads.paths) for(let i=1;i<path.length;i++)
    index.add(road.id,'road',strip(path[i-1],path[i],radius));
  for(const j of roads.junctions) for(const c of j.corners) index.add(j.id,'road',c);
  for(const w of town.walls) w.boundary.forEach((id,i,ids)=>{
    if(w.activeSegments[i]) index.add(w.id,'wall',strip(vertex(id),vertex(ids[(i+1)%ids.length]),1.25));
  });
  return index;
}
export function facadeInfo(ring: XY[], winding: number, index: Occupancy, id: string) {
  return ring.flatMap((a,i)=>{
    const b=ring[(i+1)%ring.length], line=b.clone().sub(a), length=line.length();
    if(length<.001) return [];
    const normal=point(b.y-a.y,a.x-b.x).normalize().multiplyScalar(winding);
    const neighbors=[...index.nearby(at(a,b,.5),length/2+.3)].filter(o=>o.kind==='building'&&o.id!==id);
    const origin=a.clone().addScaledVector(normal,.14), cuts=[0,1];
    // An annex may cover only part of a nave wall. Split that frontage at
    // crossings with the offset exterior line before assigning its windows.
    for(const o of neighbors) for(const [k,p] of o.ring.entries()){
      const edge=o.ring[(k+1)%o.ring.length].clone().sub(p), denom=line.cross(edge);
      if(Math.abs(denom)<1e-9) continue;
      const delta=p.clone().sub(origin),t=delta.cross(edge)/denom,u=delta.cross(line)/denom;
      if(t>0 && t<1 && u>=0 && u<=1) cuts.push(t);
    }
    cuts.sort((l,r)=>l-r);
    const spans:{l:number;r:number;exposed:boolean}[]=[];
    for(let k=1;k<cuts.length;k++){
      const l=cuts[k-1],r=cuts[k]; if(r-l<1e-7) continue;
      const q=origin.clone().addScaledVector(line,(l+r)/2);
      const exposed=!neighbors.some(o=>inRing(q,o.ring)||ringDistance(q,o.ring)<.09);
      const last=spans.at(-1);
      if(last?.exposed===exposed) last.r=r; else spans.push({l,r,exposed});
    }
    return spans.map(({l,r,exposed})=>{
      const center=at(a,b,(l+r)/2);
      return {a:at(a,b,l),b:at(a,b,r),length:length*(r-l),normal,center,exposed,
        distance:index.streetDistance(center.clone().addScaledVector(normal,.36))};
    });
  });
}
