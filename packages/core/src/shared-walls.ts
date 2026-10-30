import { RetryableError } from './context.js';
import { containsCoordinate, Point, Polygon } from './geometry.js';
import { inRing, intersection, mixPoint, pointKey, splitSegment } from './terrain-geometry.js';
import type { Point2, TownData, Vertex } from './types.js';

/** Internal plan units; scalePlannedTown multiplies lengths by four (24 m). */
export const MIN_CASTLE_CITY_WALL_GAP = 6;
const EPS = 1e-7;
const side = (a: Point2, b: Point2, p: Point2) => (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
const distance = (a: Point2, b: Point2) => Math.hypot(a.x-b.x,a.y-b.y);
const parameter = (p: Point2, a: Point2, b: Point2) => ((p.x-a.x)*(b.x-a.x)+(p.y-a.y)*(b.y-a.y))/((b.x-a.x)**2+(b.y-a.y)**2);
const pointDistance = (p: Point2, a: Point2, b: Point2) => distance(p,mixPoint(a,b,Math.max(0,Math.min(1,parameter(p,a,b)))));
const onSegment = (p: Point2, a: Point2, b: Point2) => pointDistance(p,a,b)<EPS;
const segmentDistance = (a: Point2,b: Point2,c: Point2,d: Point2) => intersection(a,b,c,d) ? 0 : Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b));

/** Extend the exposed castle sides to the city's perimeter. The city owns each
 * shared span; the castle keeps a closed logical ring with those spans inactive.
 * Both consumers therefore draw/build a shared wall and junction tower once.
 * Existing buildings, parcels, roads and gate locations are never displaced.
 */
export function connectCastleToCityWall(town: Pick<TownData, 'vertices' | 'walls' | 'gates' | 'buildings' | 'districts'>, waterCuts: Point2[][] = [], minimumGap = MIN_CASTLE_CITY_WALL_GAP): void {
  const city=town.walls.find(w=>w.kind==='city'),castle=town.walls.find(w=>w.kind==='castle');
  if(!city||!castle)return;
  const vertices=new Map(town.vertices.map(v=>[v.id,v]));
  const outer=city.boundary.map(id=>vertices.get(id)!),original=castle.boundary.map(id=>vertices.get(id)!);
  const edges=<T>(ring:T[])=>ring.map((a,i)=>[a,ring[(i+1)%ring.length]] as const);
  const cityEdges=edges(outer),castleEdges=edges(original);
  // A completed attachment is stable when the operation is repeated.
  if(castle.boundary.some((id,i)=>!castle.activeSegments[i]&&city.boundary.includes(id)&&city.boundary.includes(castle.boundary[(i+1)%castle.boundary.length])))return;
  const close=castleEdges.some(([a,b],i)=>castle.activeSegments[i]&&cityEdges.some(([c,d],j)=>city.activeSegments[j]&&segmentDistance(a,b,c,d)<minimumGap-EPS));
  if(!close)return;
  const removed=new Set<number>();
  castleEdges.forEach(([a,b],i)=>{
    const dx=b.x-a.x,dy=b.y-a.y,length=distance(a,b);
    if(cityEdges.some(([c,d],j)=>{
      const other=distance(c,d),alignment=(dx*(d.x-c.x)+dy*(d.y-c.y))/(length*other);
      return city.activeSegments[j]&&alignment>.5&&pointDistance(mixPoint(a,b,.5),c,d)<minimumGap-EPS;
    }))removed.add(i);
  });
  if(!removed.size)throw new RetryableError('Castle walls are too close to the city wall to remain independent');
  // Castle sites are convex. Keeping the interior support lines while removing
  // the exposed ones creates a real extension, rather than overlapping strokes.
  if(castleEdges.some(([a,b])=>original.some(p=>side(a,b,p)<-EPS)))throw new RetryableError('Cannot safely attach a concave castle wall');
  let outline:Point2[]=[...outer];
  castleEdges.forEach(([a,b],i)=>{
    if(removed.has(i))return;
    const next:Point2[]=[];
    for(const [p,q] of edges(outline)){
      const sp=side(a,b,p),sq=side(a,b,q),ip=sp>=-EPS,iq=sq>=-EPS;
      if(ip)next.push(p);
      if(ip!==iq)next.push(mixPoint(p,q,sp/(sp-sq)));
    }
    outline=next.filter((p,j)=>!j||distance(p,next[j-1])>EPS);
    if(outline.length>1&&distance(outline[0],outline.at(-1)!)<EPS)outline.pop();
  });
  const polygon=new Polygon(outline.map(p=>new Point(p.x,p.y)));
  const oldPolygon=new Polygon(original.map(p=>new Point(p.x,p.y)));
  // Collinear retained edges may differ by floating-point roundoff after
  // clipping. Test with a metric tolerance rather than proper-crossing signs.
  if(outline.length<3||polygon.square<=EPS||original.some(p=>!containsCoordinate(polygon,new Point(p.x,p.y))&&Math.min(...edges(outline).map(([a,b])=>pointDistance(p,a,b)))>EPS))throw new RetryableError('Castle wall attachment does not preserve its enclosure');
  // The change is confined to the narrow strip being joined, never a large
  // expansion across another district or around the opposite side of the city.
  if(outline.some(p=>!containsCoordinate(oldPolygon,new Point(p.x,p.y))&&Math.min(...castleEdges.map(([a,b])=>pointDistance(p,a,b)))>minimumGap+EPS))throw new RetryableError('Castle wall attachment would extend beyond its reserved gap');
  const byPosition=new Map(town.vertices.map(v=>[pointKey(v),v]));
  const add=(p:Point2):Vertex=>{
    const old=byPosition.get(pointKey(p))??[...original,...outer].find(v=>distance(p,v)<EPS);if(old)return old;
    const v={id:`v${town.vertices.length}`,x:p.x,y:p.y};town.vertices.push(v);vertices.set(v.id,v);byPosition.set(pointKey(v),v);return v;
  };
  // Retain original gate/corner vertices on surviving castle sides. Include all
  // city subdivisions so shared spans use exactly the same endpoint IDs.
  const ring:Vertex[]=[];
  for(const [a,b] of edges(outline)){
    const candidates=[add(a),...original.filter(p=>onSegment(p,a,b)),...outer.filter(p=>onSegment(p,a,b))];
    const sorted=[...new Map(candidates.map(p=>[p.id,p])).values()].sort((p,q)=>parameter(p,a,b)-parameter(q,a,b));
    ring.push(...sorted.filter(p=>parameter(p,a,b)<1-EPS));
  }
  const ids=ring.map(v=>v.id),gates=town.gates.filter(g=>g.wallId===castle.id);
  if(gates.some(g=>!ids.includes(g.vertexId)))throw new RetryableError('Castle wall attachment would move its entrance');
  const shared=edges(ring).map(([a,b])=>cityEdges.some(([c,d])=>onSegment(a,c,d)&&onSegment(b,c,d)));
  if(!shared.some(Boolean))throw new RetryableError('Castle wall attachment has no shared span');
  const active=edges(ring).map(([a,b],i)=>!shared[i]&&castleEdges.some(([c,d],j)=>castle.activeSegments[j]&&onSegment(mixPoint(a,b,.5),c,d)));
  // New ends extend an existing side along its support line.
  edges(ring).forEach(([a,b],i)=>{
    if(shared[i])return;
    if(!active[i])active[i]=castleEdges.some(([c,d],j)=>castle.activeSegments[j]&&Math.abs(side(c,d,a))/distance(c,d)<EPS&&Math.abs(side(c,d,b))/distance(c,d)<EPS);
    if(active[i]&&splitSegment(a,b,waterCuts).some((p,j,parts)=>j>0&&waterCuts.some(c=>inRing(c,mixPoint(parts[j-1],p,.5)))))throw new RetryableError('Castle wall attachment crosses water');
    const extended=!castleEdges.some(([c,d])=>onSegment(a,c,d)&&onSegment(b,c,d));
    if(active[i]&&extended&&town.buildings.some(building=>{
      if(town.districts.find(d=>d.id===building.districtId)?.wardType==='Castle')return false;
      const footprint=building.boundary.map(id=>vertices.get(id)!);
      const after=Math.min(...edges(footprint).map(([c,d])=>segmentDistance(a,b,c,d)));
      const before=Math.min(...castleEdges.flatMap(([p,q])=>edges(footprint).map(([c,d])=>segmentDistance(p,q,c,d))));
      return after<2.2-EPS&&after<before-EPS;
    }))throw new RetryableError('Castle wall attachment crosses a building clearance');
  });
  const junctions=ring.filter((p,i)=>shared[i]!==shared[(i+ring.length-1)%ring.length]);
  if(junctions.some(p=>cityEdges.some(([a,b],i)=>!city.activeSegments[i]&&onSegment(p,a,b)&&parameter(p,a,b)>EPS&&parameter(p,a,b)<1-EPS)))throw new RetryableError('Castle wall attachment would obstruct a city gate');
  const boundary:string[]=[],segments:boolean[]=[];
  cityEdges.forEach(([a,b],i)=>{
    const points=[a,...ring.filter(p=>p.id!==a.id&&p.id!==b.id&&onSegment(p,a,b))].sort((p,q)=>parameter(p,a,b)-parameter(q,a,b));
    for(const p of points){boundary.push(p.id);segments.push(city.activeSegments[i]);}
  });
  city.boundary=boundary;city.activeSegments=segments;
  // Junction towers take priority over nearby original city towers. Remove
  // castle towers on the shared path, including duplicate junction towers.
  const gatePoints=town.gates.map(g=>vertices.get(g.vertexId)!);
  const junctionIds:string[]=[];
  for(const p of junctions)if(!gatePoints.some(g=>distance(p,g)<minimumGap)&&!junctionIds.some(id=>distance(p,vertices.get(id)!)<minimumGap))junctionIds.push(p.id);
  city.towerVertexIds=[...junctionIds,...city.towerVertexIds.filter(id=>!junctions.some(p=>distance(p,vertices.get(id)!)<minimumGap))];
  castle.boundary=ids;castle.activeSegments=active;
  castle.towerVertexIds=castle.towerVertexIds.filter(id=>{
    const i=ids.indexOf(id);return i>=0&&!shared[i]&&!shared[(i+ids.length-1)%ids.length]&&!junctions.some(p=>distance(p,vertices.get(id)!)<minimumGap)&&!city.towerVertexIds.some(other=>distance(vertices.get(id)!,vertices.get(other)!)<minimumGap);
  });
}
