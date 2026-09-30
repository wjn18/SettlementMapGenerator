import { Point, Polygon, containsPolygon, intersect } from './geometry.js';
import { inRing, intersection, mixPoint, pointKey, splitSegment } from './terrain-geometry.js';
import { polygonTouchesRiver } from './river.js';
import type { Point2, TownData, Vertex } from './types.js';

const cross = (a: Point2, b: Point2, c: Point2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** A compact envelope of the developed core, independent of parcel corners.
 * Convex support lines bridge the narrow yards and recesses that would otherwise
 * make a defensive perimeter follow every step of the parcel subdivision. */
export function defensiveEnvelope(points: readonly Point2[], clearance = 3): Polygon {
  const sorted = [...new Map(points.map(p => [pointKey(p), new Point(p.x, p.y)])).values()].sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (source: Point[]) => {
    const out: Point[] = [];
    for (const p of source) { while (out.length >= 2 && cross(out.at(-2)!, out.at(-1)!, p) <= 1e-7) out.pop(); out.push(p); }
    return out;
  };
  const lower = half(sorted), upper = half([...sorted].reverse());
  const hull = new Polygon([...lower.slice(0, -1), ...upper.slice(0, -1)]);
  // Remove negligible changes of bearing before offsetting the support lines.
  // The outward clearance is greater than the permitted simplification error.
  let changed = true;
  while (changed && hull.length > 4) {
    changed = false;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[(i + hull.length - 1) % hull.length], p = hull[i], b = hull[(i + 1) % hull.length];
      const depth = Math.abs(cross(a, b, p)) / Point.distance(a, b);
      if (depth < clearance * 0.35) { hull.splice(i, 1); changed = true; break; }
    }
  }
  const shifted = hull.map((a, i) => {
    const b = hull[(i + 1) % hull.length], direction = b.subtract(a);
    const normal = new Point(direction.y, -direction.x).norm();
    const support = Math.max(0, ...sorted.map(p => p.subtract(a).dot(normal)));
    const outward = normal.scale(clearance + support);
    return { a: a.add(outward), direction };
  });
  return new Polygon(shifted.map((line, i) => {
    const before = shifted[(i + shifted.length - 1) % shifted.length];
    const t = intersect(before.a.x, before.a.y, before.direction.x, before.direction.y, line.a.x, line.a.y, line.direction.x, line.direction.y);
    return t ? before.a.add(before.direction.scale(t.x)) : line.a;
  }));
}

/** Replace the city fortification in exported topology. Street/parcel geometry
 * stays in place: crossings share gate vertices and buildings respect the new
 * wall corridor. Castle walls remain their own compact enclosure. */
export function rebuildCityFortifications(town: TownData, waterCuts: Point2[][] = []): void {
  const wall = town.walls.find(w => w.kind === 'city');
  if (!wall) return;
  const vertices = new Map(town.vertices.map(v => [v.id, v]));
  const byPosition = new Map(town.vertices.map(v => [pointKey(v), v]));
  const add = (p: Point2): Vertex => {
    const key = pointKey(p), old = byPosition.get(key); if (old) return old;
    const v = { id: `v${town.vertices.length}`, x: p.x, y: p.y };
    town.vertices.push(v); vertices.set(v.id, v); byPosition.set(key, v); return v;
  };
  const castle = town.walls.find(w => w.kind === 'castle');
  const envelope = defensiveEnvelope([...wall.boundary, ...(castle?.boundary ?? [])].map(id => vertices.get(id)!));
  const wet = (p: Point2) => waterCuts.some(c => inRing(c, p));
  const oldGateIds = new Set(wall.gateIds), oldEntrances = new Set(town.gates.filter(g => oldGateIds.has(g.id)).map(g => g.vertexId));
  town.gates = town.gates.filter(g => !oldGateIds.has(g.id));
  town.entrances = town.entrances.filter(id => !oldEntrances.has(id));
  wall.gateIds = [];
  const bridgeRoads = new Set(town.river?.bridges.map(b => b.roadId) ?? []);
  const crossings: { vertex: Vertex; edge: number; t: number; halfWidth: number }[] = [];
  for (const road of town.roads) {
    // River crossings are already separate bridge structures, not land gates.
    if (bridgeRoads.has(road.id)) continue;
    const original = road.vertexIds.map(id => vertices.get(id)!), next: string[] = [];
    for (let i = 1; i < original.length; i++) {
      const a = original[i - 1], b = original[i], hits: { t: number; vertex: Vertex }[] = [];
      for (let edge = 0; edge < envelope.length; edge++) {
        const c = envelope[edge], d = envelope[(edge + 1) % envelope.length], hit = intersection(a, b, c, d);
        if (!hit) continue;
        const p = mixPoint(a, b, hit[0]); if (wet(p)) continue;
        const vertex = add(p);
        hits.push({ t: hit[0], vertex });
        const previous = crossings.find(g => g.vertex.id === vertex.id);
        // Oblique roads need a correspondingly wider opening in the wall.
        const sine = Math.abs((b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x)) / Math.hypot(b.x - a.x, b.y - a.y) / Point.distance(c, d);
        const halfWidth = Math.min(8, (road.width / 2 + 0.5) / Math.max(0.35, sine));
        if (previous) previous.halfWidth = Math.max(previous.halfWidth, halfWidth);
        else crossings.push({ vertex, edge, t: hit[1], halfWidth });
      }
      next.push(a.id, ...hits.sort((a, b) => a.t - b.t).map(h => h.vertex.id));
    }
    next.push(original.at(-1)!.id);
    road.vertexIds = next.filter((id, i) => i === 0 || id !== next[i - 1]);
  }
  for (const crossing of crossings) {
    const id = `gate-city-${wall.gateIds.length}`;
    wall.gateIds.push(id); town.gates.push({ id, wallId: wall.id, vertexId: crossing.vertex.id }); town.entrances.push(crossing.vertex.id);
  }
  const boundary: string[] = [], active: boolean[] = [], towerCandidates: string[] = [];
  for (let edge = 0; edge < envelope.length; edge++) {
    const a = envelope[edge], b = envelope[(edge + 1) % envelope.length], length = Point.distance(a, b);
    const gates = crossings.filter(g => g.edge === edge), cuts = [0, 1];
    const parameter = (p: Point2) => ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (length * length);
    cuts.push(...splitSegment(a, b, waterCuts).map(parameter));
    const intervals = Math.max(1, Math.ceil(length / 22));
    for (let i = 1; i < intervals; i++) cuts.push(i / intervals);
    for (const gate of gates) cuts.push(gate.t, Math.max(0, gate.t - gate.halfWidth / length), Math.min(1, gate.t + gate.halfWidth / length));
    const ts = cuts.sort((a, b) => a - b).filter((v, i, all) => !i || v - all[i - 1] > 1e-7);
    for (let i = 0; i < ts.length - 1; i++) {
      const p = add(mixPoint(a, b, ts[i])), mid = mixPoint(a, b, (ts[i] + ts[i + 1]) / 2);
      boundary.push(p.id);
      active.push(!wet(mid) && !gates.some(g => Math.abs((ts[i] + ts[i + 1]) / 2 - g.t) * length < g.halfWidth + 1e-7));
      if ((ts[i] === 0 || Math.abs(ts[i] * intervals - Math.round(ts[i] * intervals)) < 1e-7) && !wet(p) && !crossings.some(g => Math.hypot(g.vertex.x - p.x, g.vertex.y - p.y) < g.halfWidth + 4)) towerCandidates.push(p.id);
    }
  }
  wall.boundary = boundary; wall.activeSegments = active;
  wall.towerVertexIds = [];
  for (const id of towerCandidates) {
    const i = boundary.indexOf(id), p = vertices.get(id)!;
    if (!(active[i] || active[(i + active.length - 1) % active.length])) continue;
    if (wall.towerVertexIds.some(other => { const q = vertices.get(other)!; return Math.hypot(p.x - q.x, p.y - q.y) < 10; })) continue;
    wall.towerVertexIds.push(id);
  }
  town.entrances = [...new Set(town.entrances)];
  const corridors = boundary.flatMap((id, i) => active[i] ? [[vertices.get(id)!, vertices.get(boundary[(i + 1) % boundary.length])!]] : []);
  const clear = (ids: string[]) => !corridors.some(path => polygonTouchesRiver(ids.map(id => vertices.get(id)!), { centerline: path, width: 4.4, bankWidth: 0 }));
  town.buildings = town.buildings.filter(b => clear(b.boundary));
  town.features = town.features.filter(f => clear(f.boundary));
  for (const d of town.districts) d.withinWalls = d.withinCity && containsPolygon(envelope, d.boundary.map(id => { const v = vertices.get(id)!; return new Point(v.x, v.y); }));
  town.bounds = { minX: Math.min(...town.vertices.map(v => v.x)), minY: Math.min(...town.vertices.map(v => v.y)), maxX: Math.max(...town.vertices.map(v => v.x)), maxY: Math.max(...town.vertices.map(v => v.y)) };
}
