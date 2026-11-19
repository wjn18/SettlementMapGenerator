import type { District } from '@settlement/core';
import { at, circle, mean, MeshBatch, point, strip, world, type XY } from './mesh.js';
import { inRing, mount, ringDistance, type Focus, type Kit, type Mount, type Occupancy } from './placement.js';

const goods: Kit[]=['goods_food_01','goods_pottery_01','goods_cloth_01','goods_iron_01'];
const dyes=['#a15f49','#627f73','#ac8851','#65758b'];
export function market(mesh: MeshBatch, district: District, ring: XY[], index: Occupancy, mounts: Mount[], seed: number): Focus | undefined {
  const center=mean(ring);
  const axis=ring.map((a,i)=>ring[(i+1)%ring.length].clone().sub(a)).sort((a,b)=>b.lengthSq()-a.lengthSq())[0].normalize();
  const perpendicular=point(-axis.y,axis.x);
  const radius=Math.max(...ring.map(p=>p.distanceTo(center)));
  let stalls=0, first: XY | undefined;
  // Place two facing rows around a pedestrian aisle. Source streets, buildings
  // and plaza features have priority when selecting each stall footprint.
  for (let offset=0;offset<radius && stalls<10;offset+=6.3) {
    for (const x of offset ? [offset,-offset] : [0]) for (const side of [-1,1]) {
      const p=center.clone().addScaledVector(axis,x).addScaledVector(perpendicular,side*5.1);
      if (!inRing(p,ring) || ringDistance(p,ring)<3.3 || !index.free(p,3.1)) continue;
      const across=perpendicular.clone().multiplyScalar(side);
      const xy=(u:number,v:number)=>p.clone().addScaledVector(axis,u).addScaledVector(across,v);
      const variant=(seed%4+stalls)%4, id=district.id+'/stall-'+stalls;
      const yaw=Math.atan2(axis.y,axis.x);
      mesh.entity(id,()=>{
        for (const u of [-1.48,1.48]) for (const v of [-.85,.85])
          mesh.prism(circle(xy(u,v),.085,6),.01,2.15,'#795c40');
        mesh.prism(strip(xy(-1.50,-.54),xy(1.50,-.54),.37),.73,.89,'#a5865d',true);
        for(let s=0;s<7;s++) {
          const l=-1.74+s*3.48/7,r=l+3.48/7, cloth=s%2?'#e4d8b4':dyes[variant];
          for(const v of [-1,1]) {
            mesh.quad(world(xy(l,0),2.77),world(xy(r,0),2.77),world(xy(r,v*.66),2.50),world(xy(l,v*.66),2.50),cloth);
            mesh.quad(world(xy(l,v*.66),2.50),world(xy(r,v*.66),2.50),world(xy(r,v*1.12),2.20),world(xy(l,v*1.12),2.20),cloth);
            mesh.quad(world(xy(l,v*1.12),2.2),world(xy(r,v*1.12),2.2),world(xy(r,v*1.12),1.96),world(xy(l,v*1.12),1.96),cloth);
          }
        }
      });
      mounts.push(mount(goods[variant],district.id,xy(0,-.52),.89,yaw,[.84,.84,.84],1),
        mount('citizen_merchant_01',district.id,xy(.5,.45),.02,yaw+(side>0?0:Math.PI),[1,1,1],1),
        mount(stalls%2?'citizen_basket_01':'citizen_walking_01',district.id,xy(-.67,-1.95),.02,yaw+(side>0?Math.PI:0),[1,1,1],1));
      index.add(id,'decor',strip(xy(-1.9,0),xy(1.9,0),2.35));
      first ??= p; stalls++;
    }
  }
  if (first) return {target:world(at(first,center,.28),1.7),direction:[.56,.7,.85],span:24};
}
