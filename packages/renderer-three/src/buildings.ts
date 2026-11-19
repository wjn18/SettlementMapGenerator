import type { Building } from '@settlement/core';
import { ShapeUtils } from 'three';
import { at, circle, mean, MeshBatch, point, strip, world, type XY } from './mesh.js';
import { wallDetail } from './facades.js';
import { facadeInfo, faceYaw, fitKit, inRing, mount, ringDistance, type Focus, type Kit, type Mount, type Occupancy } from './placement.js';

const slates = ['#adb7ba', '#b7bdba', '#a8b4b8', '#b3ada1', '#c6ad90', '#c4a787'];
const plasters = ['#e4d4b6', '#e9dcc6', '#ddc8a9', '#e0ceb8'];
export function hash(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
// Split each footprint triangle at the ridge. Concave outlines and skewed gables
// keep their actual footprint instead of expanding to a bounding rectangle.
function halfFace(poly: XY[], signed: (p: XY) => number) {
  const clipped: XY[] = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length], da = signed(a), db = signed(b);
    if (da >= 0) clipped.push(a);
    if (da * db < 0) clipped.push(at(a, b, da / (da - db)));
  });
  return clipped;
}
export function building(mesh: MeshBatch, item: Building, ring: XY[], ward: string, seed: number,
    index: Occupancy, mounts: Mount[], keep: boolean, warehouse: boolean) {
  const choice = hash(seed + '/' + item.id);
  const church = ward === 'Cathedral';
  const tower = item.architecturalRole === 'bell_tower';
  const farm=ward==='Farm', wealthy=ward==='PatriciateWard' || ward==='AdministrationWard';
  const stone = church || keep || ward==='Castle';
  const stories = farm ? 1 : 2 + Number(choice % 5 === 0 || wealthy);
  const eave = keep ? 12.8 : tower ? 13.5 : church ? (item.architecturalRole==='annex'?5.3:9) : stories * 2.65 + (choice % 11) / 12;
  const plaster = stone ? '#c9beaa' : farm ? '#d1b693' : plasters[choice % plasters.length];
  const slate = church || keep ? '#81959a' : slates[(choice >>> 5) % slates.length];
  const edges = ring.map((a, i) => ring[(i + 1) % ring.length].clone().sub(a));
  const axis = edges.reduce((a, b) => a.lengthSq() > b.lengthSq() ? a : b).clone().normalize();
  const cross = point(-axis.y, axis.x), coordinates = ring.map(p => p.dot(cross));
  const low = Math.min(...coordinates), high = Math.max(...coordinates);
  const radius = Math.max(0.02, (high - low) / 2);
  const mid = low + (high-low)*(stone ? .5 : .46 + (choice%7)*.014);
  const distance = (p: XY) => p.dot(cross) - mid;
  const rise = tower ? 0 : Math.min(keep ? 5 : 7, radius * (church ? 0.98 : .70 + (choice % 8) * .045));
  const us=ring.map(p=>p.dot(axis)), u0=Math.min(...us),u1=Math.max(...us);
  const planes=[(p:XY)=>rise*(1-distance(p)/Math.max(.01,high-mid)),(p:XY)=>rise*(1+distance(p)/Math.max(.01,mid-low))];
  const hip=!tower && !church && (keep || wealthy || choice%4===0);
  if(hip) { const slope=rise/Math.max(.1,Math.min(radius*.85,(u1-u0)*.39));
    planes.push(p=>slope*(p.dot(axis)-u0),p=>slope*(u1-p.dot(axis))); }
  const height=(p:XY)=>eave+Math.max(0,Math.min(...planes.map(f=>f(p))));
  const tris = ShapeUtils.triangulateShape(ring, []);
  for (const face of tris) {
    const tri = face.map(i => ring[i]);
    for (const [k, plane] of (tower ? planes.slice(0,1) : planes).entries()) {
      let cut=tri;
      for(const other of planes) if(other!==plane && !tower) cut=halfFace(cut,p=>other(p)-plane(p));
      for (let j = 1; j + 1 < cut.length; j++) {
        mesh.triangle(world(cut[0], height(cut[0])), world(cut[j], height(cut[j])), world(cut[j + 1], height(cut[j + 1])), slate,1);
      }
      for(const other of planes.slice(k+1)) {
        const seam=cut.filter(p=>!tower && Math.abs(plane(p)-other(p))<1e-7);
        if(seam.length>=2) {
          const l=seam[0],r=seam.reduce((best,p)=>p.distanceToSquared(l)>best.distanceToSquared(l)?p:best,l);
          mesh.line(world(l,height(l)+.03),world(r,height(r)+.03));
          if(k===0 && other===planes[1] && l.distanceTo(r)>.04) {
            const ridge=strip(l,r,church ? .16 : .12), h=eave+rise;
            mesh.quad(world(ridge[0],h-.06),world(ridge[1],h-.06),world(r,h+.12),world(l,h+.12),slate);
            mesh.quad(world(l,h+.12),world(r,h+.12),world(ridge[2],h-.06),world(ridge[3],h-.06),slate);
          }
        }
      }
    }
  }
  const winding = ShapeUtils.area(ring) > 0 ? 1 : -1;
  const walls=facadeInfo(ring,winding,index,item.id);
  const front=walls.filter(w=>w.exposed && w.length>2).sort((a,b)=>(a.distance-b.distance)-.08*(a.length-b.length))[0];
  const types: Kit[]=['sign_bakery_01','sign_cobbler_01','sign_draper_01','sign_grocer_01','sign_potter_01','sign_smith_01','sign_tavern_01'];
  const shop = !stone && !farm && !wealthy && /Craftsmen|Merchant|Gate|Trade/.test(ward) && choice%3!==0;
  function install(kit:Kit,p:XY,h:number,yaw:number,w:number,tall:number,depth?:number,detail=1) {
    mounts.push(mount(kit,item.id,p,h,yaw,fitKit(kit,w,tall,depth),detail));
  }
  walls.forEach(wall => {
    const {a,b,normal,length,exposed}=wall, yaw=faceYaw(normal);
    const cuts=[0,1];
    for(let k=0;k<planes.length;k++) for(const other of planes.slice(k+1)) {
      const da=planes[k](a)-other(a),db=planes[k](b)-other(b);
      if(da*db<0) cuts.push(da/(da-db));
    }
    const edge=[...new Set(cuts)].sort((l,r)=>l-r).map(t=>at(a,b,t));
    for (let j = 1; j < edge.length; j++) {
      const l = edge[j - 1], r = edge[j];
      mesh.quad(world(l), world(r), world(r, height(r)), world(l, height(l)), plaster,stone?2:0);
      mesh.line(world(l, height(l)), world(r, height(r)));
      if(exposed) {
        const offset=normal.clone().multiplyScalar(stone ? .15 : .23);
        const ll=l.clone().add(offset),rr=r.clone().add(offset);
        mesh.quad(world(l,height(l)),world(r,height(r)),world(rr,height(r)-.08),world(ll,height(l)-.08),slate);
        mesh.quad(world(ll,height(l)-.08),world(rr,height(r)-.08),world(rr,height(r)-.26),world(ll,height(l)-.26),stone?'#ac9f88':'#8c7058');
      }
    }
    mesh.line(world(a), world(a, height(a)));
    if (!exposed || length < 1.3) return;
    const pos=(t:number,d=.035)=>at(a,b,t).addScaledVector(normal,d);
    const facade = (t: number, h: number) => world(pos(t), h);
    const bays = Math.max(1, Math.min(14, Math.floor(length / (church?3.4:2.85))));
    const facadeFloors = church ? 1 : stories;
    mesh.quad(facade(0,.04),facade(1,.04),facade(1,.48),facade(0,.48),'#ad9d85');
    const timber = '#88745e', glass = church ? '#718587' : '#637676';
    const detail=wallDetail(mesh,a,b,normal);
    const crest=edge.reduce((top,p)=>height(p)>height(top)?p:top,a);
    const gable=height(crest)-eave, peak=crest.distanceTo(a);
    if(!stone) {
      for(const t of [.08,length-.08]) detail.beam(t,.15,t,eave,.18,'#725b46',.15);
      detail.beam(0,eave-.10,length,eave-.10,.20,'#785e48',.16);
      if(gable>1.15 && peak>.5 && peak<length-.5) {
        detail.beam(peak,eave,peak,eave+gable-.19,.16,'#795f49');
        for(const end of [0,length]) {
          detail.beam(end,eave+.05,peak,eave+gable-.12,.17,'#80654c',.16);
          for(const t of [.33,.67]) {
            const u=peak+(end-peak)*t, z=height(at(a,b,u/length));
            if(z>eave+.5) detail.beam(u,eave,u,z-.16,.11,'#80654c');
          }
        }
        if(gable>2.4 && length>4.5) install('opening_03',pos(peak/length,.18),eave+.27,yaw,.81,Math.min(gable-.9,1.32),.15,2);
      }
    } else if(keep) {
      for(const z of [1.05,eave*.54,eave-.65]) detail.beam(0,z,length,z,.25,'#aba08b',.29);
      const bays=Math.max(1,Math.floor(length/2.3));
      for(let i=0;i<bays;i++) {
        const l=pos(i/bays+.08/bays,.02),r=pos((i+.65)/bays,.02);
        mesh.prism(strip(l,r,.27),eave-.12,eave+1.1,'#b9ab93',true);
      }
    } else if(church && !tower) {
      detail.beam(0,eave-.24,length,eave-.24,.24,'#b3a48c',.28);
      if(gable>1.4 && item.architecturalRole==='main_hall') detail.rose(peak,eave+.15,Math.min(1.58,gable*.44,peak*.43,(length-peak)*.43));
      for(let i=0;i<=bays;i++) {
        const t=.045+.91*i/bays;
        if(length>=4 && index.free(pos(t,.70),.38,item.id)) detail.buttress(t*length,eave*.87);
      }
    }
    const grand=wealthy && wall===front && length>=5.4;
    if(grand) install(choice%2?'patriciate_facade_01':'patriciate_facade_02',pos(.5),.08,yaw,length*.88,Math.min(5.6,eave-.6),.48);
    for (let floor = 0; floor < facadeFloors; floor++) {
      if(grand && floor<2) continue;
      const base = floor * eave / facadeFloors;
      if (floor && !church) mesh.quad(facade(0, base), facade(1, base), facade(1, base + .13), facade(0, base + .13), timber);
      for (let bay = 0; bay < bays; bay++) {
        const t = (bay + .5) / bays, half = Math.min(.42 / length, .32 / bays);
        const door = floor === 0 && wall===front && bay===Math.floor(bays/2);
        const sill = base + (door ? .07 : church ? eave*.30 : .91), lintel = sill + (door ? 2.12 : church ? eave*.49 : 1.13);
        mesh.quad(facade(t - half, sill), facade(t + half, sill), facade(t + half, lintel), facade(t - half, lintel), door ? '#78644e' : glass);
        const kit:Kit=door ? (keep?'castle_keep_openings_01__entrance':church?'cathedral_openings_01__pointed_door':warehouse?'harbor_warehouse_door_01':choice%2?'opening_04':'opening_05')
          : keep?'castle_keep_openings_01__arrow_loop':church?'cathedral_openings_01__lancet_window':wealthy||choice%7===0?'opening_03':(bay+choice)%3===0?'opening_02':'opening_01';
        const available=length/bays*.82;
        const w=Math.min(available,warehouse&&door ? 3.4 : keep&&!door ? .55 : church&&!door ? 1.25 : door ? 1.43 : 1.60);
        install(kit,pos(t,.055),sill,yaw,w,door&&stone?Math.min(eave*.5,3.7):lintel-sill,undefined,door||church?1:2);
        if(door && !stone && available>2.35 && index.free(pos(t,.45),.26,item.id)) {
          mesh.prism(strip(pos(t-.68/length,.15),pos(t+.68/length,.15),.22),.035,.14,'#b6a68f');
          detail.lantern(t*length+.94);
        }
        if(door && farm && length>5 && index.free(pos(.5,1.15),.82,item.id)) {
          install(choice%2?'farm_barn_01__facade_and_shelter':'farm_cottage_01__facade_and_shelter',pos(t,.09),.07,yaw,Math.min(4.4,length*.8),2.8,1.05);
        }
        if(door && warehouse && eave>4.4 && index.free(pos(t,1.35),.75,item.id)) {
          install('harbor_warehouse_hoist_01',pos(t,.1),3.0,yaw,Math.min(3.8,length*.77),1.25,1.25);
        }
        if (!stone) {
          const post = bay / bays, thick = Math.min(.12 / length, .1 / bays);
          mesh.quad(facade(post, base), facade(post + thick, base), facade(post + thick, base + eave / stories), facade(post, base + eave / stories), timber);
          if (floor && (bay === 0 || bay === bays - 1)) {
            mesh.line(facade(post + thick, base + .15), facade(t - half, lintel));
          }
          if (floor && (bay+choice)%3===0) {
            const trim:Kit=choice%3===0?'timber_panel_02':choice%3===1?'timber_panel_01':'timber_panel_04';
            // Frame the plaster panel between windows, leaving the opening unobstructed.
            if(length/bays>2.4) install(trim,pos((bay+.13)/bays,.04),base+.13,yaw,length/bays*.21,eave/stories-.27,.09,2);
          }
        }
      }
    }
    if(shop && wall===front && length>4.5 && index.free(pos(.36,.8),.42,item.id)) {
      const doorAt=(Math.floor(bays/2)+.5)/bays;
      const t=doorAt*.46, depth=Math.min(1.05,length*.12), width=Math.min(3.3,(doorAt-.14)*length*.82);
      const p=pos(t,.06), along=b.clone().sub(a).normalize();
      const left=p.clone().addScaledVector(along,-width/2),right=p.clone().addScaledVector(along,width/2);
      const stripes=['#8c4f3c','#55766c','#737f95','#a78044'];
      for(let s=0;s<7;s++) {
        const l=at(left,right,s/7),r=at(left,right,(s+1)/7);
        const ll=l.clone().addScaledVector(normal,depth),rr=r.clone().addScaledVector(normal,depth);
        const cloth=s%2?'#eee0bf':stripes[choice%4];
        mesh.quad(world(l,2.78),world(r,2.78),world(rr,2.38),world(ll,2.38),cloth);
        mesh.quad(world(ll,2.38),world(rr,2.38),world(rr,2.15),world(ll,2.15),cloth);
      }
      const sign=pos(.77,.50);
      install(types[choice%types.length],sign,2.35,yaw+Math.PI/2,1.06,1.37,.20);
      mesh.line(world(pos(.77),3.63),world(sign,3.63));
      if(width>1.45 && index.free(pos(t,.65),.35,item.id)) {
        const l=pos(t-width*.43/length,.48),r=pos(t+width*.43/length,.48);
        mesh.prism(strip(l,r,.28),.70,.83,'#937752',true);
        for(const post of [l,r]) mesh.prism(circle(post,.09,4),.02,.71,'#795f46');
        const wares:Kit[]=['goods_food_01','goods_cloth_01','goods_pottery_01','goods_iron_01'];
        install(wares[choice%4],pos(t,.49),.83,yaw,Math.min(1.6,width*.78),.5,.54,2);
      }
    }
  });
  const central=mean(ring), clearance=ringDistance(central,ring);
  if(tower && inRing(central,ring)) {
    const scale=Math.min(1.4,clearance*.74/1.8);
    mounts.push(mount('cathedral_belfry_01',item.id,central,eave,0,[scale,scale,scale]));
  }
  if(keep) ring.forEach(v=>{
    const t=at(v,central,.085); const d=Math.min(3.7,ringDistance(t,ring)*2.4);
    if(d>.48) install('castle_keep_turret_01',t,eave-.55,0,d,5.1,d,0);
  });
  if (tris.length && !stone && choice % 4 !== 0) {
    const largest = tris.reduce((a, b) => Math.abs(ShapeUtils.area(a.map(i => ring[i]))) >= Math.abs(ShapeUtils.area(b.map(i => ring[i]))) ? a : b);
    const center = mean(largest.map(i => ring[i]));
    const base = height(center);
    const r=Math.min(.54,radius*.19);
    mesh.prism(circle(center,r,4),base-.62,base+1.24,'#af8972',true);
    mesh.prism(circle(center,r*1.20,4),base+1.18,base+1.42,'#c5ac98',true);
    mesh.surface([circle(center,r*.61,4).map(q=>[q.x,q.y])],base+1.43,'#645a52');
    if(!farm && front && radius>1.85) {
      const q=at(central,front.center,.53);
      const roofNormal=cross.clone().multiplyScalar(distance(q)>=0?1:-1);
      const size=Math.min(1.12,ringDistance(q,ring)*.68);
      if(inRing(q,ring) && size>.5 && center.distanceTo(q)>size+.48) {
        const kit:Kit=choice%3===0?'dormer_01':choice%3===1?'dormer_02':'dormer_03';
        mounts.push(mount(kit,item.id,q,height(q)-size*.56,faceYaw(roofNormal),[size,size,size],1));
      }
    }
  }
  const n=front?.normal??point(.5,-.86), street=front?.center??central;
  const focus:Focus={target:world(street,Math.min(eave*.59,6)),direction:[n.x+.35*n.y,.68,-n.y+.35*n.x],span:Math.max(16,Math.min(35,(front?.length??10)*1.9))};
  return {focus,shop,center:central};
}
