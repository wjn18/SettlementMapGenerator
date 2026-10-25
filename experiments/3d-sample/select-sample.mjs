import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateTown, serializeTown } from '@settlement/core';

// Reproducible sample from the existing city planner. Original coordinates are
// never translated, simplified, rescaled or edited in this selection artifact.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'artifacts/3d-sample');
await fs.mkdir(out, { recursive: true });
const options = { seed: 7, size: 6, walls: true, castle: false, plaza: true };
const result = generateTown(options);
if (!result.ok) throw new Error(JSON.stringify(result.error));
const town = result.town;
const vertices = new Map(town.vertices.map(v => [v.id, { x: v.x, y: v.y }]));
const selectedIds = new Set(['d14', 'd36', 'd37']);
const point = id => vertices.get(id);
const points = ids => ids.map(point);
const districts = town.districts.filter(d => selectedIds.has(d.id)).map(d => ({
  id: d.id, wardType: d.wardType, points: points(d.boundary),
}));
const buildings = town.buildings.filter(b => selectedIds.has(b.districtId)).map(b => ({
  id: b.id, districtId: b.districtId,
  wardType: districts.find(d => d.id === b.districtId).wardType,
  points: points(b.boundary),
}));
// The outline follows the selected districts; an empty strip is included east
// and south to retain their actual city wall and its two original gate gaps.
const cropPolygon = [
  point('v32'), point('v33'), point('v34'), point('v35'),
  { x: 108, y: -90 }, { x: 106, y: -5 }, { x: 86, y: 138 },
  { x: -16, y: 136 }, point('v14'), point('v13'), point('v12'),
  point('v11'), point('v21'),
];
const EPS = 1e-8;
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
function inside(p, poly = cropPolygon) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    const cross = (p.x-a.x)*(b.y-a.y)-(p.y-a.y)*(b.x-a.x);
    if (Math.abs(cross) < EPS && p.x >= Math.min(a.x,b.x)-EPS && p.x <= Math.max(a.x,b.x)+EPS && p.y >= Math.min(a.y,b.y)-EPS && p.y <= Math.max(a.y,b.y)+EPS) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) hit = !hit;
  }
  return hit;
}
function clipSegment(a, b) {
  const ts = [0, 1], dx = b.x-a.x, dy = b.y-a.y;
  for (let i = 0; i < cropPolygon.length; i++) {
    const c = cropPolygon[i], d = cropPolygon[(i+1)%cropPolygon.length];
    const ex = d.x-c.x, ey = d.y-c.y, den = dx*ey-dy*ex;
    if (Math.abs(den) < EPS) continue;
    const t = ((c.x-a.x)*ey-(c.y-a.y)*ex)/den;
    const u = ((c.x-a.x)*dy-(c.y-a.y)*dx)/den;
    if (t > EPS && t < 1-EPS && u >= -EPS && u <= 1+EPS) ts.push(t);
  }
  ts.sort((a,b)=>a-b);
  const result = [];
  for (let i=0; i<ts.length-1; i++) if (ts[i+1]-ts[i]>EPS && inside(lerp(a,b,(ts[i]+ts[i+1])/2))) result.push([lerp(a,b,ts[i]),lerp(a,b,ts[i+1])]);
  return result;
}
function same(a,b) { return Math.hypot(a.x-b.x,a.y-b.y)<EPS; }
function clipPath(ps, closed, active = []) {
  const chains = [];
  for (let i=0; i<ps.length-(closed?0:1); i++) {
    for (const [a,b] of clipSegment(ps[i],ps[(i+1)%ps.length])) {
      let chain = chains.at(-1);
      if (!chain || !same(chain.points.at(-1),a)) {
        chain = { points:[a], activeSegments:[], sourceSegments:[] };
        chains.push(chain);
      }
      chain.points.push(b); chain.activeSegments.push(active[i] ?? true); chain.sourceSegments.push(i);
    }
  }
  return chains;
}
const roads = town.roads.flatMap(road=>clipPath(points(road.vertexIds),false).map((c,i)=>({
  id: `${road.id}-clip-${i}`, sourceId:road.id, kind:road.kind,
  width:road.width, points:c.points, sourceSegments:c.sourceSegments,
})));
const walls = town.walls.flatMap(wall=>clipPath(points(wall.boundary),true,wall.activeSegments).map((c,i)=>({
  id:`${wall.id}-clip-${i}`, sourceId:wall.id, kind:wall.kind,
  points:c.points, activeSegments:c.activeSegments, sourceSegments:c.sourceSegments, closed:false,
  gatePoints:town.gates.filter(g=>g.wallId===wall.id).map(g=>point(g.vertexId)).filter(p=>inside(p)),
  towerPoints:points(wall.towerVertexIds).filter(p=>inside(p)),
})));
const features = town.features.filter(f=>selectedIds.has(f.districtId)).map(f=>({
  id:f.id,districtId:f.districtId,kind:f.kind,points:points(f.boundary),
}));
const bounds = {
  minX:Math.min(...cropPolygon.map(p=>p.x)),minY:Math.min(...cropPolygon.map(p=>p.y)),
  maxX:Math.max(...cropPolygon.map(p=>p.x)),maxY:Math.max(...cropPolygon.map(p=>p.y)),
};
const omittedInside = town.buildings.filter(b=>!selectedIds.has(b.districtId)).filter(b=>{
  const ps=points(b.boundary); const center={x:ps.reduce((s,p)=>s+p.x,0)/ps.length,y:ps.reduce((s,p)=>s+p.y,0)/ps.length};
  return inside(center) || ps.some(p=>inside(p));
}).map(b=>b.id);
const clippedBuildings=buildings.filter(b=>b.points.some(p=>!inside(p))).map(b=>b.id);
if (omittedInside.length || clippedBuildings.length) throw new Error(JSON.stringify({omittedInside,clippedBuildings}));
const selection={
  source:{file:'source-town.json',kind:'generated-with-existing-core',options,
    note:'Existing p5 fixtures were inspected first; those with a city wall and plaza required >40 buildings in a compact plaza-to-wall crop. This uses current core without changing generator logic.'},
  seed:options.seed,generatorVersion:town.generatorVersion,buildings,districts,roads,walls,features,
  plaza:{id:'d37',points:districts.find(d=>d.id==='d37').points},bounds,cropPolygon,
  stats:{buildingCount:buildings.length,buildingCountsByDistrict:Object.fromEntries(districts.map(d=>[d.id,buildings.filter(b=>b.districtId===d.id).length])),
    originalBuildingCount:town.buildings.length,selectedDistrictCount:districts.length,
    wallChainCount:walls.length,gateCount:town.gates.filter(g=>inside(point(g.vertexId))).length,
    unselectedBuildingsInsideCrop:omittedInside,buildingsClipped:clippedBuildings,
    suggestedMetersPerPlanUnit:0.5,
    cropRule:'Complete district buildings and features are copied unchanged. Concave crop follows district boundaries, plus empty eastern/southern wall strip. Roads and walls are clipped by exact line/polygon intersection; active/inactive wall segments are preserved. Each wall is an OPEN chain (closed:false), with activeSegments.length=points.length-1. No new enclosing wall is added.',
  },
};
await fs.writeFile(path.join(out,'source-town.json'),serializeTown(town)+'\n');
await fs.writeFile(path.join(out,'selection.json'),JSON.stringify(selection,null,2)+'\n');
const toPath=ps=>ps.map(p=>`${p.x},${p.y}`).join(' ');
const outline=toPath(cropPolygon);
const colors={MerchantWard:'#bdaf96',CraftsmenWard:'#d4bca2',Market:'#efdfb8'};
const W=bounds.maxX-bounds.minX,H=bounds.maxY-bounds.minY,pad=15;
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="${bounds.minX-pad} ${bounds.minY-pad} ${W+pad*2} ${H+pad*2}"><rect x="${bounds.minX-pad}" y="${bounds.minY-pad}" width="${W+pad*2}" height="${H+pad*2}" fill="#fffdf7"/><polygon points="${outline}" fill="#eee8db" stroke="#a39887" stroke-width=".8"/>`;
for(const d of districts) svg+=`<polygon points="${toPath(d.points)}" fill="${d.wardType==='Market'?'#f5e2af':'#f3eee3'}" stroke="#c3bba9" stroke-width=".35"/>`;
for(const r of roads) svg+=`<polyline points="${toPath(r.points)}" fill="none" stroke="#d2bfa0" stroke-width="${r.width}" stroke-linecap="round"/>`;
for(const b of buildings) svg+=`<polygon points="${toPath(b.points)}" fill="${colors[b.wardType]}" stroke="#453c32" stroke-width=".55"/>`;
for(const w of walls){for(let i=0;i<w.points.length-1;i++)if(w.activeSegments[i])svg+=`<polyline points="${toPath([w.points[i],w.points[i+1]])}" fill="none" stroke="#665c4c" stroke-width="2.4"/>`;for(const p of w.towerPoints)svg+=`<circle cx="${p.x}" cy="${p.y}" r="3.6" fill="#bfb5a5" stroke="#453c32" stroke-width=".6"/>`;for(const p of w.gatePoints)svg+=`<circle cx="${p.x}" cy="${p.y}" r="3.3" fill="#f8f2df" stroke="#956f43" stroke-width=".8"/>`;}
for(const f of features)svg+=`<polygon points="${toPath(f.points)}" fill="#938775" stroke="#453c32" stroke-width=".45"/>`;
for(const b of buildings){const p={x:b.points.reduce((s,p)=>s+p.x,0)/b.points.length,y:b.points.reduce((s,p)=>s+p.y,0)/b.points.length};svg+=`<text x="${p.x}" y="${p.y}" text-anchor="middle" font-family="Arial" font-size="2.7" fill="#312d28">${b.id}</text>`;}
svg+=`<text x="38" y="-35" text-anchor="middle" font-family="Arial" font-size="6" fill="#6e5c43">MARKET d37</text><text x="${bounds.minX}" y="${bounds.minY-5}" font-family="Arial" font-size="4.7" fill="#453c32">35 ORIGINAL FOOTPRINTS · SEED 7 · CORE ${town.generatorVersion}</text></svg>`;
await fs.writeFile(path.join(out,'planning-selection.svg'),svg);
console.log(JSON.stringify({output:out,buildings:buildings.length,bounds,stats:selection.stats},null,2));
