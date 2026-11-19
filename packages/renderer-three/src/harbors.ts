import type { Point2, RiverBerth, TownData } from '@settlement/core';
import clip, { type Polygon } from 'polygon-clipping';
import { kitCatalog } from './kit-catalog.js';
import { at, circle, MeshBatch, pair, point, strip, world, type XY } from './mesh.js';
import { faceYaw, fitKit, inRing, mount, type Focus, type Mount } from './placement.js';

const fleet = {
  rowboat:'harbor_rowboat_01', cargo:'harbor_river_cargo_01','cargo-sloop':'harbor_cargo_sloop_01',
  'cargo-ketch':'harbor_cargo_ketch_01','cargo-lugger':'harbor_cargo_lugger_01',
} as const satisfies Record<RiverBerth['boat'],string>;
type Vessel = typeof fleet[keyof typeof fleet] | 'harbor_merchant_ship_01' | 'harbor_fishing_boat_01';
export function waterways(town: TownData, local: (p: Point2)=>XY) {
  const river=town.river?.surface?.map(local) ?? [], sea=town.terrain?.coast?.water.map(local) ?? [];
  return {river, sea};
}
export function harbors(mesh: MeshBatch,town: TownData,local: (p: Point2)=>XY,mounts: Mount[],waterLevel: number) {
  const docks=town.terrain?.docks??[], hulls: Polygon[]=[], occupied: Polygon[]=[];
  let focus: Focus | undefined;
  const {river,sea}=waterways(town,local);
  for(const dock of docks) {
    const path=dock.points.map(local);
    for(let i=1;i<path.length;i++) occupied.push([strip(path[i-1],path[i],dock.width*.25).map(pair)]);
  }
  function berth(kit: Vessel, center: XY,yaw: number,scale: number,id: string, water:XY[]) {
    if(water.length<3) return;
    const {length,width,stations,sections}=kitCatalog[kit].hull;
    const upper=sections.findIndex(s=>s[0]>=0), [z0,r0]=sections[upper-1], [z1,r1]=sections[upper];
    const waterline=r0+(r1-r0)*(-z0)/(z1-z0);
    const forward=point(Math.cos(yaw),Math.sin(yaw)), normal=point(-forward.y,forward.x);
    const xy=(u:number,v:number)=>center.clone().addScaledVector(forward,u*scale).addScaledVector(normal,v*scale);
    const outline=(ratio:number):Polygon=>[[...stations.map(([u,w])=>pair(xy(u*length,w*width*.5*ratio))),
      ...[...stations].reverse().map(([u,w])=>pair(xy(u*length,-w*width*.5*ratio)))]];
    const clearance=outline(1.06);
    if(clip.difference(clearance,[water.map(pair)]).length || occupied.some(q=>clip.intersection(q,clearance).length)) return;
    occupied.push(clearance); hulls.push(outline(waterline*.99));
    mounts.push(mount(kit,id,center,waterLevel,yaw,[scale,scale,scale]));
    return true;
  }
  for(const [k,dock] of docks.entries()) {
    const path=dock.points.map(local),half=dock.width*.25,deck=.17;
    if(path.length<2) continue;
    mesh.entity(dock.id,()=>{
      for(let i=1;i<path.length;i++) {
        const a=path[i-1],b=path[i],axis=b.clone().sub(a).normalize(),n=point(-axis.y,axis.x);
        const steps=Math.max(1,Math.ceil(a.distanceTo(b)/.5));
        for(let j=0;j<steps;j++){
          const planks=['#ad9170','#b89b75','#a98c69','#ba9e7c'];
          mesh.prism(strip(at(a,b,j/steps),at(a,b,(j+.98)/steps),half),-.04,deck,planks[j%4]);
        }
        const piles=Math.max(1,Math.ceil(a.distanceTo(b)/4));
        for(let j=0;j<=piles;j++) for(const side of [-1,1]) {
          const p=at(a,b,j/piles).addScaledVector(n,side*(half-.19));
          mesh.prism(circle(p,.15,8),waterLevel-1.5,deck+.23,'#796750');
          if(j===piles) mounts.push(mount('harbor_bollard_01',dock.id,p,deck+.23,0,[1,1,1],1));
        }
      }
    });
    const a=path[path.length-2],b=path[path.length-1], axis=b.clone().sub(a).normalize();
    const normal=point(-axis.y,axis.x);
    let target=at(a,b,.67);
    if(dock.riverHarbor) {
      const slot=dock.riverHarbor.berth,kit=fleet[slot.boat],p=local(slot.center);
      const bounds=kitCatalog[kit].size,scale=Math.min(slot.length*.47/bounds[0],slot.beam*.47/bounds[2]);
      if(berth(kit,p,slot.heading,scale,dock.id,river)) target=at(p,target,.35);
    } else {
      const kit=k%2?'harbor_fishing_boat_01':'harbor_merchant_ship_01', scale=1;
      for(const side of [-1,1]) {
        const p=target.clone().addScaledVector(normal,side*(half+kitCatalog[kit].size[2]*.5+.48));
        if(berth(kit,p,Math.atan2(axis.y,axis.x),scale,dock.id,sea)) {target=at(p,target,.4); break;}
      }
    }
    focus ??= {target:world(target,1.7), direction:[axis.x+.42*normal.x,.70,-axis.y-.42*normal.y],span:33};
  }
  const shoreline=town.terrain?.coast?.shoreline.map(local)??[];
  const starts=docks.filter(d=>d.waterbody!=='river' && d.points.length).map(d=>local(d.points[0]));
  for(let i=1;i<shoreline.length && starts.length;i++) {
    const a=shoreline[i-1],b=shoreline[i],axis=b.clone().sub(a).normalize();
    const length=a.distanceTo(b), count=Math.max(1,Math.ceil(length/4.2));
    for(let j=0;j<count;j++) {
      const c=at(a,b,(j+.5)/count);
      if(starts.every(s=>s.distanceTo(c)>22)) continue;
      const normal=point(-axis.y,axis.x);
      if(!inRing(c.clone().addScaledVector(normal,.3),sea)) normal.negate();
      const l=at(a,b,j/count),r=at(a,b,(j+1)/count);
      if(river.length && clip.intersection([strip(l,r,.5).map(pair)],[river.map(pair)]).length) continue;
      const id='quay/'+i+'/'+j, yaw=faceYaw(normal);
      mounts.push(mount('harbor_quay_01',id,c,-1.72,yaw,fitKit('harbor_quay_01',length/count,1.84,.66)));
      if((i+j)%4 || starts.some(s=>s.distanceTo(c)<3.2)) continue;
      const outer=c.clone().addScaledVector(normal,1.4);
      const landing:Polygon=[strip(c,outer,1.1).map(pair)];
      if(!occupied.some(p=>clip.intersection(p,landing).length)) mounts.push(mount('harbor_quay_steps_01',id,at(c,outer,.5),-1.2,yaw,[1,1,.74],1));
    }
  }
  return {hulls,focus};
}
