import type { TownData } from './types.js';

/** Separate wall subdivision vertices from architectural tower placements.
 * Coordinates can be internal plan units (metresPerUnit=4) or public metres. */
export function selectWallTowerIds(town: Pick<TownData,'vertices'|'walls'>, metresPerUnit=1): Map<string,string[]> {
  const vertices=new Map(town.vertices.map(v=>[v.id,v]));
  const distance=(a:string,b:string)=>{const p=vertices.get(a)!,q=vertices.get(b)!;return Math.hypot(p.x-q.x,p.y-q.y)*metresPerUnit;};
  const castle=town.walls.find(w=>w.kind==='castle');
  const junctions=new Set(castle?.boundary.filter((id,i)=>castle.activeSegments[i]!==castle.activeSegments[(i+castle.boundary.length-1)%castle.boundary.length])??[]);
  const candidates=town.walls.flatMap(w=>w.towerVertexIds.map((id,index)=>{
    const i=w.boundary.indexOf(id),p=vertices.get(id)!,a=vertices.get(w.boundary[(i+w.boundary.length-1)%w.boundary.length])!,b=vertices.get(w.boundary[(i+1)%w.boundary.length])!;
    const dot=((p.x-a.x)*(b.x-p.x)+(p.y-a.y)*(b.y-p.y))/Math.hypot(p.x-a.x,p.y-a.y)/Math.hypot(b.x-p.x,b.y-p.y);
    const turn=Math.acos(Math.max(-1,Math.min(1,dot)));
    return {id,wall:w,index,turn,score:(w.kind==='city'&&junctions.has(id)?10:0)+(turn>Math.PI/12?2:0)};
  })).sort((a,b)=>b.score-a.score||(a.wall.kind===b.wall.kind?0:a.wall.kind==='city'?-1:1)||a.index-b.index);
  const kept:typeof candidates=[];
  for(const candidate of candidates) {
    const minimum=candidate.wall.kind==='city'?40:32;
    if(kept.some(previous=>distance(candidate.id,previous.id)<Math.max(minimum,previous.wall.kind==='city'?40:32)-1e-5))continue;
    kept.push(candidate);
  }
  return new Map(town.walls.map(w=>[w.id,w.towerVertexIds.filter(id=>kept.some(c=>c.wall.id===w.id&&c.id===id))]));
}

export function planWallTowers(town: Pick<TownData,'vertices'|'walls'>, metresPerUnit=1): void {
  const selected=selectWallTowerIds(town,metresPerUnit);
  for(const wall of town.walls)wall.towerVertexIds=selected.get(wall.id)!;
}
