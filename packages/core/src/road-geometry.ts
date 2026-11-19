import { Point } from './geometry.js';
import { quadraticBend } from './road-curves.js';
import { distanceToPath, segmentsDistance } from './river.js';
import { inRing, pointKey } from './terrain-geometry.js';
import type { Point2, Road, TownData } from './types.js';

interface Junction { id: string; center: Point2; radius: number; corners: Point2[][]; kind?: Road['kind'] }
interface Edge { id: string; unit: Point; length: number; radius: number }
interface BendView { center: Point2; along: Point2; width: number }
export interface RoadGeometry { paths: Map<string,Point2[]>; junctions: Junction[]; view?: BendView }

// Plan-space obstacles. Only edges near the current corner participate in curve fitting.
function roadObstacles(town: TownData, vertex: (id: string) => Point) {
  const edges: {a: Point2; b: Point2; margin: number; x0: number; y0: number; x1: number; y1: number}[] = [];
  const add = (a: Point2, b: Point2, margin = 0) => edges.push({a,b,margin,
    x0:Math.min(a.x,b.x)-margin, y0:Math.min(a.y,b.y)-margin, x1:Math.max(a.x,b.x)+margin, y1:Math.max(a.y,b.y)+margin});
  const rings: {points:readonly Point2[]; x0:number; y0:number; x1:number; y1:number}[]=[];
  const ring = (points: readonly Point2[]) => {
    if (!points.length) return;
    let x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
    points.forEach((a,i) => {
      add(a,points[(i+1)%points.length]);
      x0=Math.min(x0,a.x); y0=Math.min(y0,a.y); x1=Math.max(x1,a.x); y1=Math.max(y1,a.y);
    });
    rings.push({points,x0,y0,x1,y1});
  };
  for (const item of [...town.buildings,...town.features]) ring(item.boundary.map(vertex));
  if (town.terrain?.coast) ring(town.terrain.coast.water);
  if (town.river?.surface) ring(town.river.surface);
  else if (town.river) {
    const river=town.river;
    river.centerline.slice(1).forEach((b,i)=>add(river.centerline[i],b,river.width/2));
  }
  for (const w of town.walls) w.boundary.forEach((a,i) => {
    if (w.activeSegments[i]) add(vertex(a),vertex(w.boundary[(i+1)%w.boundary.length]),2.1);
  });
  return (p:Point2, reach:number) => {
    const near=(box:{x0:number;y0:number;x1:number;y1:number})=>
      box.x0<=p.x+reach && box.x1>=p.x-reach && box.y0<=p.y+reach && box.y1>=p.y-reach;
    return {edges:edges.filter(near),rings:rings.filter(near)};
  };
}
type Obstacles = ReturnType<ReturnType<typeof roadObstacles>>;

function fitBend(a: Point, p: Point, b: Point, radius: number, obstacles: Obstacles, steps: number) {
  for (const fraction of [1,.65,.35]) {
    const start=p.add(a.subtract(p).scale(fraction)), end=p.add(b.subtract(p).scale(fraction));
    const curve=quadraticBend(start,p,end,steps);
    // Do not reduce existing clearance to a footprint, wall or bank within the road width.
    if (obstacles.rings.some(r=>curve.some(q=>inRing(r.points,q)))) continue;
    const safe=obstacles.edges.every(edge=>{
      const clearance=Math.min(radius+edge.margin, segmentsDistance(start,p,edge.a,edge.b), segmentsDistance(p,end,edge.a,edge.b));
      for(let i=1;i<curve.length;i++) {
        const distance=segmentsDistance(curve[i-1],curve[i],edge.a,edge.b);
        if (distance<1e-7 || distance+1e-6<clearance) return false;
      }
      return true;
    });
    if (safe) return curve;
  }
}

// Round the inside pavement corner between adjacent branches while keeping the intersection fixed.
function junctionCorner(p: Point, a: Edge, b: Edge, obstacles: Obstacles) {
  const cross=a.unit.x*b.unit.y-a.unit.y*b.unit.x, dot=a.unit.dot(b.unit);
  if (cross<.24 || dot>.9) return;
  const da=(b.radius+a.radius*dot)/cross, db=(a.radius+b.radius*dot)/cross;
  if (da<0 || db<0) return;
  const corner=p.add(a.unit.scale(da)).add(a.unit.rotate90().scale(a.radius));
  const run=Math.min(1.8*Math.min(a.radius,b.radius),a.length*.47-da,b.length*.47-db);
  if (run<Math.min(a.radius,b.radius)*.18) return;
  for (const factor of [1,.55,.25]) {
    const curve=quadraticBend(corner.add(a.unit.scale(run*factor)),corner,corner.add(b.unit.scale(run*factor)),10);
    const patch=[corner,...curve];
    if (obstacles.rings.some(r=>inRing(r.points,corner))) return;
    if (obstacles.edges.every(e=>!inRing(patch,e.a) && patch.every((q,i)=>
      segmentsDistance(q,patch[(i+1)%patch.length],e.a,e.b)>e.margin+1e-6))) return patch;
  }
}

interface RoadEnd { unit: Point; radius: number; length: number; kind: Road['kind'] }

// Each road is meshed separately and ends perpendicular to its own final tangent.
// Join the actual end edges, including shallow turns that need no centerline fillet.
function joinRoadEnds(center: Point, a: RoadEnd, b: RoadEnd, locked: boolean, nearby: ReturnType<typeof roadObstacles>) {
  const [wide,narrow] = a.radius >= b.radius ? [a,b] : [b,a];
  const nw = wide.unit.rotate90(), nn = narrow.unit.rotate90();
  const corners: Point2[][] = [];
  let narrowRadius = narrow.radius;
  if (!locked && wide.kind===narrow.kind && wide.radius>narrow.radius && wide.unit.dot(narrow.unit)<-.9) {
    const run = Math.min(narrow.length*.45, (wide.radius-narrow.radius)*5);
    if (run>wide.radius-narrow.radius) {
      const left:Point[]=[], right:Point[]=[];
      for (let i=0;i<=8;i++) {
        const t=i/8, p=center.add(narrow.unit.scale(run*t));
        const r=wide.radius+(narrow.radius-wide.radius)*t*t*(3-2*t);
        left.push(p.add(nn.scale(r))); right.push(p.add(nn.scale(-r)));
      }
      const taper=[...left,...right.reverse()];
      const obstacles=nearby(center,run+wide.radius);
      if (!obstacles.rings.some(r=>inRing(r.points,center)) &&
          obstacles.edges.every(e=>!inRing(taper,e.a) && taper.every((p,i)=>
            segmentsDistance(p,taper[(i+1)%taper.length],e.a,e.b)>e.margin+1e-6))) {
        corners.push(taper);
        narrowRadius=wide.radius;
      }
    }
  }
  if (Math.abs(nw.x*nn.y-nw.y*nn.x)>1e-8) {
    const x=nw.scale(wide.radius), y=nn.scale(narrowRadius);
    corners.push([center.add(x),center.add(y),center.subtract(x),center.subtract(y)]);
  }
  return corners;
}

/** Derived road centerlines and curb returns used by both workshop views. Source IDs retain their original topology. */
export function buildRoadGeometry(town: TownData): RoadGeometry {
  const vertices=new Map(town.vertices.map(v=>[v.id,new Point(v.x,v.y)]));
  const vertex=(id:string)=>vertices.get(id)!;
  const neighbors=new Map<string,Map<string,number>>();
  const locks=new Set([...town.entrances,...town.gates.map(g=>g.vertexId)]);
  const decks=new Set(town.river?.bridges.map(b=>b.roadId));
  const abutments=new Set(town.river?.bridges.flatMap(b=>b.points.map(pointKey)));
  const docks=town.terrain?.docks??[];
  for (const road of town.roads) {
    const landings=docks.filter(d=>d.roadId===road.id).map(d=>d.points[0]);
    road.vertexIds.forEach((id,i,ids)=>{
      if (decks.has(road.id) || abutments.has(pointKey(vertex(id)))) locks.add(id);
      const next=ids[i+1];
      if (!next || Point.distance(vertex(id),vertex(next))<1e-7) return;
      if (landings.some(p=>distanceToPath(p,[vertex(id),vertex(next)])<1e-5)) { locks.add(id); locks.add(next); }
      for (const [from,to] of [[id,next],[next,id]]) {
        let edges=neighbors.get(from);
        if (!edges) { edges=new Map(); neighbors.set(from,edges); }
        edges.set(to,Math.max(road.width/2,edges.get(to)??0));
      }
    });
  }

  const nearby=roadObstacles(town,vertex), halves=new Map<string,Map<string,Point[]>>();
  const junctions:Junction[]=[];
  let view:BendView|undefined, best=0;
  const turns=new Map<string,number>();
  for (const [id,links] of neighbors) if (links.size===2 && !locks.has(id)) {
    const [a,b]=[...links.keys()].map(next=>vertex(next).subtract(vertex(id)).norm());
    const angle=Math.acos(Math.max(-1,Math.min(1,-a.dot(b))));
    if (angle>=Math.PI/25 && angle<=Math.PI*.91) turns.set(id,angle);
  }
  for (const [id,linked] of neighbors) {
    if (linked.size<2) continue;
    const p=vertex(id);
    const edges:Edge[]=Array.from(linked,([id,radius])=>{
      const v=vertex(id).subtract(p);
      return {id,unit:v.norm(),length:v.length,radius};
    });
    const radius=Math.max(...edges.map(e=>e.radius));
    if (edges.length>2) {
      const corners:Point2[][]=[];
      if (!locks.has(id)) {
        edges.sort((a,b)=>Math.atan2(a.unit.y,a.unit.x)-Math.atan2(b.unit.y,b.unit.x));
        const obstacles=nearby(p,radius*10);
        edges.forEach((a,i)=>{
          const corner=junctionCorner(p,a,edges[(i+1)%edges.length],obstacles);
          if (corner) corners.push(corner);
        });
      }
      junctions.push({id,center:p,radius,corners});
      continue;
    }
    const angle=turns.get(id);
    if (!angle) continue;
    const [a,b]=edges;
    // Only split the available length when the other endpoint also needs a fillet.
    // Reserve a straight run through the full depth of each protected approach.
    const trim=(e:Edge)=>Math.min(e.length*(turns.has(e.id) ? .49 : .98), locks.has(e.id) ? Math.max(0,e.length-4.3) : Infinity, radius*4.5);
    const run=Math.min(trim(a),trim(b));
    if (run<radius*.10) continue;
    const curve=fitBend(p.add(a.unit.scale(run)),p,p.add(b.unit.scale(run)),radius,nearby(p,run+radius),2*Math.max(4,Math.ceil(angle/(Math.PI/16))));
    if (!curve) continue;
    const middle=(curve.length-1)/2, center=curve[middle];
    halves.set(id,new Map([[a.id,curve.slice(0,middle+1).reverse()],[b.id,curve.slice(middle)]]));
    const shift=Point.distance(center,p);
    if (shift>best) { best=shift; view={center,along:b.unit.subtract(a.unit).norm(),width:radius*2}; }
  }

  const paths=new Map<string,Point2[]>();
  const ends=new Map<string,{id:string; center:Point; arms:RoadEnd[]; locked:boolean}>();
  for (const r of town.roads) {
    const line:Point2[]=[];
    const append=(p:Point2)=>{const last=line.at(-1); if (!last || last.x!==p.x || last.y!==p.y) line.push({x:p.x,y:p.y});};
    for (let i=1;i<r.vertexIds.length;i++) {
      const a=r.vertexIds[i-1], b=r.vertexIds[i];
      if (a===b) continue;
      const start=halves.get(a)?.get(b), end=halves.get(b)?.get(a);
      if (start) start.forEach(append); else append(vertex(a));
      if (end) for(let j=end.length-1;j>=0;j--) append(end[j]); else append(vertex(b));
    }
    if (!line.length && r.vertexIds.length) append(vertex(r.vertexIds[0]));
    paths.set(r.id,line);
    if (line.length<2) continue;
    for (const start of [true,false]) {
      const id=start?r.vertexIds[0]:r.vertexIds[r.vertexIds.length-1];
      if ((neighbors.get(id)?.size??0)>2) continue;
      const p=start?line[0]:line[line.length-1], q=start?line[1]:line[line.length-2];
      const key=pointKey(p), delta=new Point(q.x-p.x,q.y-p.y);
      let end=ends.get(key);
      if (!end) {end={id,center:new Point(p.x,p.y),arms:[],locked:false}; ends.set(key,end);}
      if (locks.has(id)) end.locked=true;
      end.arms.push({unit:delta.norm(),length:delta.length,radius:r.width/2,kind:r.kind});
    }
  }
  for (const {id,center,arms,locked} of ends.values()) {
    if (arms.length!==2) continue;
    const [a,b]=arms;
    junctions.push({id,center,radius:Math.min(a.radius,b.radius),kind:a.kind===b.kind?a.kind:'street',
      corners:joinRoadEnds(center,a,b,locked,nearby)});
  }
  return {paths,junctions,view};
}
