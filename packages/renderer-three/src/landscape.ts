import type { Bridge, TownData } from '@settlement/core';
import { buildRoadGeometry, selectWallTowerIds } from '@settlement/core';
import { ShapeUtils } from 'three';
import clip, { type Polygon } from 'polygon-clipping';
import { at, circle, MeshBatch, pair, point, strip, world, type XY } from './mesh.js';
import { inRing, type Focus, type Mount } from './placement.js';
import { buildWallGates } from './gates.js';
import { buildWallTower } from './wall-tower.js';
import { waterways } from './harbors.js';

export const waterLevel = -1.15;
const roadLevel = .035;
export function localRoads(town: TownData, local: (p:{x:number;y:number})=>XY) {
  const {paths,junctions,view}=buildRoadGeometry(town);
  const focus: Focus | undefined = view && {target:world(local(view.center),.1),
    direction:[view.along.x,2.4,-view.along.y],span:Math.max(32,view.width*2.5)};
  return {
    paths:town.roads.map(r=>({road:r,path:paths.get(r.id)!.map(local),radius:r.width*.25})),
    junctions:junctions.map(j=>({id:j.id,center:local(j.center),radius:j.radius*.5,corners:j.corners.map(c=>c.map(local)),pattern:j.kind==='external'?0:4})),
    focus,
  };
}
export type LocalRoads = ReturnType<typeof localRoads>;
function bankCrests(town: TownData, roads: LocalRoads, shore: XY[], vertex: (id: string) => XY, ymin: number, ymax: number) {
  const width = Math.min(2.2, town.river!.bankWidth * .225);
  const obstacles: {a: XY; b: XY; margin: number}[] = [];
  const add = (a: string, b: string, margin: number) => obstacles.push({ a: vertex(a), b: vertex(b), margin });
  for (const {path,radius} of roads.paths) path.slice(1).forEach((b,i)=>obstacles.push({a:path[i],b,margin:radius+.12}));
  for (const {corners} of roads.junctions) for (const c of corners) c.forEach((a,i)=>obstacles.push({a,b:c[(i+1)%c.length],margin:.12}));
  for (const item of [...town.buildings, ...town.features]) {
    item.boundary.forEach((a, i, ids) => add(a, ids[(i + 1) % ids.length], .12));
  }
  for (const wall of town.walls) wall.boundary.forEach((a, i, ids) => {
    if (wall.activeSegments[i]) add(a, ids[(i + 1) % ids.length], 1.37);
  });
  function clearance(p: XY, padding = 0) {
    let free = width;
    for (const {a, b, margin} of obstacles) {
      const limit = free + margin + padding;
      if (p.x < Math.min(a.x,b.x)-limit || p.x > Math.max(a.x,b.x)+limit ||
          p.y < Math.min(a.y,b.y)-limit || p.y > Math.max(a.y,b.y)+limit) continue;
      const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
      const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
      free = Math.min(free, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t) - margin - padding);
      if (free <= 0) return 0;
    }
    return free;
  }
  const winding = Math.sign(ShapeUtils.area(shore));
  const segments = shore.map((a, i) => {
    const b = shore[(i + 1) % shore.length];
    return a.x === b.x ? width : clearance(at(a, b, .5), a.distanceTo(b) / 2);
  });
  return shore.map((p, i) => {
    const prev = (i + shore.length - 1) % shore.length, next = (i + 1) % shore.length;
    const sign = -winding * Math.sign(shore[next].x - shore[prev].x);
    const gap = Math.min(clearance(p), segments[prev], segments[i], sign > 0 ? ymax - p.y : p.y - ymin);
    return point(p.x, p.y + sign * Math.max(0, gap));
  });
}
// Cut each exposed shoreline at the mouth so no vertical wall crosses open water.
function exposedSpans(a:XY,b:XY,other:XY[]) {
  if (!other.length) return [[0,1]];
  const steps=[0,1], line=b.clone().sub(a);
  other.forEach((p,i)=>{
    const edge=other[(i+1)%other.length].clone().sub(p), denom=line.cross(edge);
    if(Math.abs(denom)<1e-9) return;
    const from=p.clone().sub(a), t=from.cross(edge)/denom, u=from.cross(line)/denom;
    if(t>0 && t<1 && u>=0 && u<=1) steps.push(t);
  });
  steps.sort((l,r)=>l-r);
  return steps.slice(1).flatMap((r,i)=> r>steps[i] && !inRing(at(a,b,(steps[i]+r)/2),other)?[[steps[i],r]]:[]);
}
export function landscape(mesh: MeshBatch, town: TownData, toLocal: (p: {x:number;y:number}) => XY, vertex: (id: string) => XY, hulls:Polygon[], roads:LocalRoads) {
  const boundary = town.bounds;
  const extent: Polygon = [[
    [boundary.minX, boundary.minY], [boundary.maxX, boundary.minY],
    [boundary.maxX, boundary.maxY], [boundary.minX, boundary.maxY],
  ].map(([x, y]) => pair(toLocal({x, y})))];
  const {river:shore,sea}=waterways(town,toLocal);
  const crests = shore.length ? bankCrests(town, roads, shore, vertex, extent[0][0][1], extent[0][2][1]) : [];
  const polygons=(rings:XY[][]):Polygon[]=>rings.filter(r=>r.length>=3).map(r=>[r.map(pair)]);
  const channels=polygons([crests,sea]), water=polygons([shore,sea]);
  mesh.entity('land', () => {
    for (const land of clip.difference(extent, ...channels)) mesh.surface(land, -.018, '#f8eed6');
    for (const [i, a] of shore.entries()) {
      const j = (i + 1) % shore.length, b = shore[j];
      if (a.x === b.x) continue;
      for(const [l,r] of exposedSpans(a,b,sea)) mesh.quad(world(at(crests[i],crests[j],l),-.018),world(at(crests[i],crests[j],r),-.018),
        world(at(a,b,r),waterLevel-.06),world(at(a,b,l),waterLevel-.06),'#cfbd9d');
    }
    const coast=town.terrain?.coast?.shoreline.map(toLocal)??[];
    for(let i=1;i<coast.length;i++) for(const [l,r] of exposedSpans(coast[i-1],coast[i],crests)) {
      const a=at(coast[i-1],coast[i],l),b=at(coast[i-1],coast[i],r);
      mesh.quad(world(a,-.018),world(b,-.018),world(b,waterLevel-.06),world(a,waterLevel-.06),'#bbab8e');
    }
  });
  if(water.length) mesh.entity('riverbed',()=>{ for(const p of clip.union(water[0],...water.slice(1))) mesh.surface(p,-2.75,'#a29378'); });
  if(shore.length) mesh.entity('river',()=>{ for(const p of clip.difference([shore.map(pair)],...polygons([sea]),...hulls)) mesh.surface(p,waterLevel,'#91bdb7',3); });
  if(sea.length) mesh.entity('sea',()=>{ for(const p of clip.difference([sea.map(pair)],...hulls)) mesh.surface(p,waterLevel,'#87b4b2',3); });
  for (const district of town.districts) {
    if (district.wardType !== 'Market' && district.wardType !== 'Farm') continue;
    const ring = district.boundary.map(id => pair(vertex(id)));
    mesh.entity(district.id, () => {
      for (const dry of clip.difference([ring], ...channels)) mesh.surface(dry, -.006, district.wardType === 'Market' ? '#cdc4af' : '#e3dfbd',district.wardType==='Market'?4:0);
    });
  }
  for (const {road,path,radius} of roads.paths) {
    const tiles: Polygon[] = [];
    for (let i = 1; i < path.length; i++) {
      if (path[i].equals(path[i - 1])) continue;
      tiles.push([strip(path[i - 1], path[i], radius).map(pair)]);
    }
    if (!tiles.length) continue;
    for (const p of path.slice(1,-1)) tiles.push([circle(p,radius,48).map(pair)]);
    // Segment ends and round joins can differ by a few floating-point ULPs.
    // Snap just the derived paving cells, well below the mesh readback tolerance.
    const cells: Polygon[] = tiles.map(tile => tile.map(ring => ring.map(([x, y]) =>
      [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6])));
    const pavement = clip.union(cells[0], ...cells.slice(1));
    mesh.entity(road.id, () => {
      for (const dry of clip.difference(pavement, ...water)) mesh.surface(dry, roadLevel, '#c9b79a',road.kind==='street'?4:0);
    });
  }
  for (const node of roads.junctions) {
    mesh.entity('junction/' + node.id, () => {
      const disk = circle(node.center, node.radius, 32).map(pair);
      for (const dry of clip.difference([disk], ...water)) mesh.surface(dry, roadLevel, '#c9b79a',node.pattern);
      for (const c of node.corners) for(const dry of clip.difference([c.map(pair)], ...water)) mesh.surface(dry, roadLevel,'#c9b79a',node.pattern);
    });
  }
}

export function archBridge(mesh: MeshBatch, source: Bridge, path: XY[]) {
  const lengths = path.slice(1).map((p, i) => p.distanceTo(path[i]));
  const length = lengths.reduce((a, b) => a + b, 0);
  const rise = Math.min(4.5, Math.max(2.4, length * .14));
  const half = source.width * .25, rail = Math.min(.34, half * .12);
  const direction = (a: XY, b: XY) => point(a.y - b.y, b.x - a.x).normalize();
  const normals = path.map((p, i) => {
    const before = direction(path[Math.max(0, i - 1)], p), after = direction(p, path[Math.min(path.length - 1, i + 1)]);
    const bisector = before.clone().add(after).normalize();
    return bisector.divideScalar(Math.max(.25, bisector.dot(i === 0 ? after : before)));
  });
  let station = 0;
  mesh.entity(source.id, () => {
    for (let i = 0; i < lengths.length; i++) {
      const span = lengths[i];
      if (!span) continue;
      const count = Math.max(2, Math.ceil(span / .8));
      const position = (step: number, side: number, lift: number) => {
        const t = step / count, progress = (station + t * span) / length;
        const z = roadLevel + rise * Math.pow(Math.max(0, Math.sin(Math.PI * progress)), 1.3);
        return world(at(path[i], path[i + 1], t).addScaledVector(at(normals[i], normals[i + 1], t), side), z + lift);
      };
      for (let j = 0; j < count; j++) {
        const k = j + 1;
        mesh.quad(position(j, -half, .002), position(k, -half, .002), position(k, half, .002), position(j, half, .002), '#cdba98');
        mesh.quad(position(j, half, -.62), position(k, half, -.62), position(k, -half, -.62), position(j, -half, -.62), '#8c8170');
        for (const edge of [-1, 1]) {
          const outer = half * edge, inner = (half - rail) * edge;
          mesh.quad(position(j, outer, -.62), position(k, outer, -.62), position(k, outer, .84), position(j, outer, .84), '#ad9e85');
          mesh.quad(position(j, inner, 0), position(k, inner, 0), position(k, inner, .84), position(j, inner, .84), '#b7aa91');
          mesh.quad(position(j, inner, .84), position(k, inner, .84), position(k, outer, .84), position(j, outer, .84), '#d0c3a6');
          mesh.line(position(j, outer, .85), position(k, outer, .85));
          if (j % 2 === 0) mesh.line(position(j, outer, -.59), position(j, outer, .1));
          for (const end of [0, count]) {
            if ((end === 0 && j === 0 && i === 0) || (end === count && k === count && i === lengths.length - 1)) {
              mesh.quad(position(end, inner, 0), position(end, outer, 0), position(end, outer, .84), position(end, inner, .84), '#b7aa91');
            }
          }
        }
      }
      station += span;
    }
    for (const [p, toward] of [[path[0], path[1]], [path[path.length - 1], path[path.length - 2]]]) {
      mesh.prism(strip(p, at(p, toward, Math.min(.8 / p.distanceTo(toward), .2)), half + .2), -1.75, roadLevel - .01, '#aa9b84');
    }
  });
}

export function fortifications(mesh: MeshBatch, town: TownData, vertex: (id: string) => XY, mounts: Mount[]) {
  const towers = selectWallTowerIds(town);
  const gateViews: Record<string, Focus> = {};
  const towerViews: Record<string, Focus> = {};
  let towerFocus: Focus | undefined, bestTower = -Infinity;
  let cityView: Focus | undefined, castleView: Focus | undefined;
  for (const wall of town.walls) {
    const gates = town.gates.filter(g => g.wallId === wall.id);
    const gatePoints = gates.map(g => vertex(g.vertexId));
    const height = wall.kind === 'castle' ? 11 : 8.5;
    const { insets, views } = buildWallGates(mesh, mounts, wall, gates, vertex, height);
    Object.assign(gateViews, views);
    const focus = Object.values(views)[0];
    if (wall.kind === 'city') cityView ??= focus; else castleView ??= focus;
    mesh.entity(wall.id, () => wall.boundary.forEach((id, i, ids) => {
      if (!wall.activeSegments[i]) return;
      const j = (i + 1) % ids.length, a = vertex(id), b = vertex(ids[j]), length = a.distanceTo(b);
      if (!length) return;
      const lo = (insets.get(id) ?? 0) / length, hi = 1 - (insets.get(ids[j]) ?? 0) / length;
      if (hi <= lo) return;
      const start = at(a,b,lo), end = at(a,b,hi);
      mesh.prism(strip(start, end, 1.05), 0, height, '#b4a68d', true);
      const count = Math.max(1, Math.floor(start.distanceTo(end) / 3.4));
      for (let k = 0; k < count; k++) mesh.prism(strip(at(start, end, (k + .16) / count), at(start, end, (k + .62) / count), 1), height, height + .85, '#bfb297');
    }));
    const ring = wall.boundary.map(vertex), winding = Math.sign(ShapeUtils.area(ring)) || 1;
    for (const id of towers.get(wall.id) ?? []) {
      const p = vertex(id), radius = Math.min(3.1, ...gatePoints.map(g => g.distanceTo(p) * .45));
      if (radius <= .12) continue;
      const i=wall.boundary.indexOf(id), prev=(i+ring.length-1)%ring.length;
      const incoming=p.clone().sub(ring[prev]).normalize(), outgoing=ring[(i+1)%ring.length].clone().sub(p).normalize();
      const axis=incoming.clone().add(outgoing);
      if (!axis.lengthSq()) axis.copy(incoming.lengthSq() ? incoming : outgoing);
      const exterior=axis.lengthSq() ? point(axis.y,-axis.x).normalize().multiplyScalar(winding) : point(1,0);
      const arms=[];
      if(wall.activeSegments[prev]) arms.push(incoming.negate());
      if(wall.activeSegments[i]) arms.push(outgoing);
      const key=wall.id+'/'+id;
      const view=buildWallTower(mesh,mounts,key,p,radius,height,exterior,arms,wall.kind==='castle');
      towerViews[key]=view;
      // Prefer a full-size tower with its outside face in the light for the inspection preset.
      const score=radius+exterior.dot(point(-.75,.48))+(wall.kind==='city'?1:0);
      if (score>bestTower) {bestTower=score; towerFocus=view;}
    }
  }
  return { gates: gateViews, towers:towerViews, towerFocus, focus: cityView ?? castleView };
}
