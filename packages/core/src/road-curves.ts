import { Point,Polygon } from './geometry.js';
import { inRing,splitSegment } from './terrain-geometry.js';
import type { Point2 } from './types.js';

/** Tangent-continuous fillets. Shared graph nodes and gate centers stay fixed;
 * short bends without enough room for the road width remain explicit corners. */
export function filletRoad(path: readonly Point[], width:number, protectedPoints:ReadonlySet<Point>, waterCuts:Point2[][]):Point[] {
  const out:Point[]=[];
  const dry=(a:Point,b:Point)=>{
    const parts=splitSegment(a,b,waterCuts);
    return !parts.slice(1).some((p,i)=>waterCuts.some(c=>inRing(c,{x:(p.x+parts[i].x)/2,y:(p.y+parts[i].y)/2})));
  };
  for(let i=0;i<path.length;i++) {
    const p=path[i];
    if(!i||i===path.length-1||protectedPoints.has(p)){out.push(p);continue;}
    const a=path[i-1],b=path[i+1],la=Point.distance(a,p),lb=Point.distance(p,b);
    const u={x:(p.x-a.x)/la,y:(p.y-a.y)/la},v={x:(b.x-p.x)/lb,y:(b.y-p.y)/lb};
    const angle=Math.acos(Math.max(-1,Math.min(1,u.x*v.x+u.y*v.y)));
    if(angle<Math.PI/36||angle>Math.PI*.82){out.push(p);continue;}
    let curve:Point[]|null=null;
    for(const factor of [1,.75,.5]) {
      const trim=Math.min(width*1.8,la*.44,lb*.44)*factor;
      const minimumRadius=trim*Math.cos(angle/2)**2/Math.sin(angle/2);
      if(minimumRadius<width*.55)continue;
      const start=new Point(p.x-u.x*trim,p.y-u.y*trim),end=new Point(p.x+v.x*trim,p.y+v.y*trim);
      const steps=Math.max(8,Math.ceil(angle/(Math.PI/36)));
      const samples=Array.from({length:steps+1},(_,j)=>{
        const t=j/steps,s=1-t;return new Point(s*s*start.x+2*s*t*p.x+t*t*end.x,s*s*start.y+2*s*t*p.y+t*t*end.y);
      });
      if(samples.slice(1).every((q,j)=>dry(samples[j],q))){curve=samples;break;}
    }
    out.push(...curve??[p]);
  }
  return out;
}

export function smoothGateRoads(paths:Polygon[],changed:ReadonlySet<Polygon>,gates:readonly Point[],widths:ReadonlyMap<Polygon,number>,waterCuts:Point2[][]):void {
  const owners=new Map<Point,Set<Polygon>>();
  for(const path of paths)for(const p of path){if(!owners.has(p))owners.set(p,new Set());owners.get(p)!.add(path);}
  const protectedPoints=new Set([...gates,...[...owners].filter(([,p])=>p.size>1).map(([p])=>p)]);
  for(const path of changed)path.splice(0,path.length,...filletRoad(path,widths.get(path)??2,protectedPoints,waterCuts));
}
