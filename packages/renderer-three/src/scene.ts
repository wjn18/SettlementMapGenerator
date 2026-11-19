import type { TownData } from '@settlement/core';
import { building } from './buildings.js';
import { ShapeUtils } from 'three';
import { archBridge, fortifications, landscape, localRoads, waterLevel } from './landscape.js';
import { circle, mean, MeshBatch, point, world, type PackedMesh, type XYZ } from './mesh.js';
import { indexTown, mount, type Focus, type FocusName, type Mount } from './placement.js';
import { harbors } from './harbors.js';
import { market } from './market.js';

export interface RiverScene {
  terrain: PackedMesh; town: PackedMesh; townBounds: [XYZ, XYZ]; bridgeFocus: XYZ; bridgeViewDirection: XYZ;
  props: { type: 'oak' | 'fountain'; position: XYZ; size: number }[];
  mounts: Mount[]; focus: Partial<Record<FocusName,Focus>>; buildings: Record<string,Focus>; gates: Record<string,Focus>;
  junctionCenters: Record<string,XYZ>;
}
export function buildRiverScene(town: TownData): RiverScene {
  const river = town.river;
  if (river && !river.surface?.length) throw new Error('河流规划缺少实际河面边界。');
  const toLocal = (p: {x:number;y:number}) => point((p.x - town.center.x) * .5, (p.y - town.center.y) * .5);
  const vertices = new Map(town.vertices.map(p => [p.id, toLocal(p)]));
  const vertex = (id: string) => {
    const p = vertices.get(id);
    if (!p) throw new Error('缺少规划顶点 ' + id);
    return p;
  };
  const terrain = new MeshBatch(), city = new MeshBatch();
  const mounts:Mount[]=[], focus:RiverScene['focus']={}, buildings:Record<string,Focus>={};
  const roads=localRoads(town,toLocal);
  const index=indexTown(town,vertex,roads);
  if (roads.focus) focus.road=roads.focus;
  const port=harbors(city,town,toLocal,mounts,waterLevel);
  if(port.focus) focus.harbor=port.focus;
  landscape(terrain, town, toLocal, vertex, port.hulls, roads);
  const wards = new Map(town.districts.map(d => [d.id, d.wardType]));
  const warehouses=new Set(town.terrain?.docks.map(d=>d.districtId));
  const keeps=new Set<string>(), inferred=new Map<string,'main_hall'|'annex'|'bell_tower'>();
  for(const d of town.districts.filter(d=>d.wardType==='Cathedral'||d.wardType==='Castle')){
    const parts=town.buildings.filter(b=>b.districtId===d.id).map(b=>{
      const ring=b.boundary.map(vertex);
      const edges=ring.map((p,i)=>p.distanceTo(ring[(i+1)%ring.length]));
      return {b,area:Math.abs(ShapeUtils.area(ring)),aspect:Math.min(...edges)/Math.max(...edges)};
    }).sort((a,b)=>b.area-a.area);
    if(!parts.length) continue;
    if(d.wardType==='Castle') {keeps.add(parts[0].b.id); continue;}
    const hall=parts.find(p=>p.b.architecturalRole==='main_hall')??parts[0];
    const rest=parts.filter(p=>p!==hall),tower=rest.find(p=>p.b.architecturalRole==='bell_tower')??rest.sort((a,b)=>b.aspect-a.aspect)[0];
    for(const p of parts) inferred.set(p.b.id,p===hall?'main_hall':p===tower?'bell_tower':'annex');
  }
  const lo: XYZ = [Infinity, 0, Infinity], hi: XYZ = [-Infinity, 15, -Infinity];
  let streetScore=-Infinity;
  for (const item of town.buildings) {
    const ring = item.boundary.map(vertex), ward = wards.get(item.districtId) ?? '';
    if(ring.length<3) continue;
    city.entity(item.id, () => {
      const role=item.architecturalRole??inferred.get(item.id);
      const start=mounts.length;
      const result=building(city,role?{...item,architecturalRole:role}:item,ring,ward,town.resolved.seed,index,mounts,keeps.has(item.id),warehouses.has(item.districtId));
      buildings[item.id]=result.focus;
      if(role==='main_hall') focus.church={...result.focus,target:world(result.center,8),span:39};
      if(keeps.has(item.id)) focus.castle={...result.focus,target:world(result.center,8),span:46};
      if(!role && !keeps.has(item.id)) {
        const sign=mounts.slice(start).some(p=>p.kit.startsWith('sign_'));
        const score=(sign?100:0)+Math.min(30,mounts.length-start)-result.center.length()*.07;
        if(score>streetScore){streetScore=score; focus.street=result.focus;}
      }
    });
    for (const p of ring) {
      lo[0] = Math.min(lo[0], p.x); hi[0] = Math.max(hi[0], p.x);
      lo[2] = Math.min(lo[2], -p.y); hi[2] = Math.max(hi[2], -p.y);
    }
  }
  const defenses = fortifications(city, town, vertex, mounts);
  if (defenses.focus) focus.gate = defenses.focus;
  for(const d of town.districts.filter(d=>d.wardType==='Market')) {
    const view=market(city,d,d.boundary.map(vertex),index,mounts,town.resolved.seed);
    if(view) focus.market??=view;
  }
  for (const item of river?.bridges??[]) archBridge(city, item, item.points.map(toLocal));
  const path = river?.bridges[0]?.points.map(toLocal)??[point(0,0),point(1,0)];
  const bridgeFocus = world(mean(path), 1);
  const along = path[path.length - 1].clone().sub(path[0]).normalize();
  const bridgeViewDirection: XYZ = [-along.y + .15 * along.x, .37, -along.x - .15 * along.y];
  if (!Number.isFinite(lo[0])) { lo.splice(0, 3, -40, 0, -40); hi.splice(0, 3, 40, 10, 40); }
  const props: RiverScene['props'] = [];
  for (const feature of town.features) {
    const ring = feature.boundary.map(vertex), c = mean(ring);
    const radius = Math.min(...ring.map(p => p.distanceTo(c)));
    if(feature.kind==='statue') {
      const r=Math.min(radius*.65,1.35);
      city.entity(feature.id,()=>{
        city.prism(circle(c,r,8),.02,.32,'#b9ac94',true);
        city.prism(circle(c,r*.72,8),.32,1.45,'#c8bba2',true);
        city.prism(circle(c,r*.85,8),1.45,1.62,'#b4a48c');
      });
      mounts.push(mount('citizen_merchant_01',feature.id,c,1.62,0,[1.1,1.1,1.1]));
      continue;
    }
    const size=Math.max(.5,radius*1.5);
    props.push({ type: feature.kind === 'grove' ? 'oak' : 'fountain', position: world(c, .04), size });
    if(feature.kind==='fountain') {
      const s=size/5.1;
      mounts.push(mount('fountain_ornament_01',feature.id,c,.04+s*.3,0,[s,s,s]),mount('water_flow_01',feature.id,c,.04+s*.48,0,[s,s,s],1));
    }
  }
  const junctionCenters = Object.fromEntries(roads.junctions.map(j => [j.id, world(j.center, .1)]));
  return { terrain: terrain.pack(), town: city.pack(), townBounds: [lo, hi], props, mounts,focus,buildings, gates: defenses.gates, junctionCenters, bridgeFocus, bridgeViewDirection };
}
