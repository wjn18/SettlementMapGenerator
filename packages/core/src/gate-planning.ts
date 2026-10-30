import { RetryableError } from './context.js';
import { Point, Polygon } from './geometry.js';
import { inRing, intersection, mixPoint, pointKey, splitSegment } from './terrain-geometry.js';
import { connectCastleToCityWall } from './shared-walls.js';
import { smoothGateRoads } from './road-curves.js';
import type { Model } from './model.js';
import type { Point2, TownData, Vertex } from './types.js';

// Internal planning units. The public map scales all lengths by four metres.
export const CITY_GATE_WIDTH = { min: 2, max: 5 } as const;
export const CASTLE_GATE_WIDTH = { min: 1.5, max: 3 } as const;
export const MIN_GATE_PIER = 2;
const EPS = 1e-6;
const distance = (a: Point2, b: Point2) => Math.hypot(b.x - a.x, b.y - a.y);
const side = (a: Point2, b: Point2, p: Point2) => ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / distance(a, b);
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
interface GateSite { original: Point; center: Point; a: Point; b: Point; edge: number; width: number; inside: boolean; outside: boolean }

/** Keep each distinct crossing as a separate gate, with a solid pier between
 * openings. Move the approach, never widen/union the openings to fit traffic. */
function spaceGates(sites: GateSite[], ring: Polygon, junctions: Point2[]): void {
  ring.forEach((a, edge) => {
    const b = ring[(edge + 1) % ring.length], length = distance(a, b);
    const gates = sites.filter(g => g.edge === edge).sort((g, h) => distance(a, g.original) - distance(a, h.original));
    if (!gates.length) return;
    const required = gates.reduce((sum, g) => sum + g.width, 0) + MIN_GATE_PIER * (gates.length - 1) + 2;
    if (required > length + EPS) throw new RetryableError('Not enough wall length for separate bounded gates');
    const centers: number[] = [];
    const obstacles = junctions.filter(p => Math.abs(side(a, b, p)) < EPS && distance(a, p) + distance(p, b) < length + EPS).map(p => distance(a, p)).sort((a, b) => a - b);
    const avoid = (position: number, half: number, direction: number) => {
      for (const p of direction === 1 ? obstacles : [...obstacles].reverse()) if (Math.abs(position - p) < half + MIN_GATE_PIER - EPS) position = p + direction * (half + MIN_GATE_PIER);
      return position;
    };
    for (let i = 0; i < gates.length; i++) {
      const minimum = i ? centers[i - 1] + (gates[i - 1].width + gates[i].width) / 2 + MIN_GATE_PIER : gates[i].width / 2 + 1;
      centers.push(avoid(Math.max(distance(a, gates[i].original), minimum), gates[i].width / 2, 1));
    }
    for (let i = gates.length - 1; i >= 0; i--) {
      const maximum = i === gates.length - 1 ? length - gates[i].width / 2 - 1 : centers[i + 1] - (gates[i + 1].width + gates[i].width) / 2 - MIN_GATE_PIER;
      centers[i] = avoid(Math.min(centers[i], maximum), gates[i].width / 2, -1);
      if (centers[i] < gates[i].width / 2 + 1 - EPS) throw new RetryableError('Separate gates cannot fit between wall junctions');
      gates[i].center = mixPoint(a, b, centers[i] / length);
      if (distance(gates[i].center, gates[i].original) > 8 + EPS) throw new RetryableError('Gate spacing requires too much road displacement');
    }
  });
}

/** Insert a normal throat and a short approach bend on either side. Shared
 * junctions retain object identity; parcel vertices themselves never move. */
function turnApproaches(paths: Polygon[], sites: GateSite[], waterCuts: Point2[][], excluded: Set<Polygon>, widths:ReadonlyMap<Polygon,number>, boundarySide = 1): void {
  if (!sites.length) return;
  const byPosition = new Map(paths.flatMap(path => path.map(p => [pointKey(p), p] as const)));
  const canonical = (p: Point): Point => {
    const key = pointKey(p), previous = byPosition.get(key);
    if (previous) return previous;
    byPosition.set(key, p); return p;
  };
  sites.forEach(g => { g.center = canonical(g.center); });
  const at = new Map(sites.map(g => [pointKey(g.original), g]));
  const changed = new Set<Polygon>();
  for (const path of paths) {
    if (excluded.has(path)) continue;
    let next: Point[] = [], runScale = 1, dry = false;
    const push = (p: Point) => { const v = canonical(p); if (!next.length || distance(next.at(-1)!, v) > EPS) next.push(v); };
    const throat = (g: GateSite, anchor: Point, fallback: number): Point => {
      const length = distance(g.a, g.b), nx = -(g.b.y - g.a.y) / length, ny = (g.b.x - g.a.x) / length;
      const depth = side(g.a, g.b, anchor), sign = Math.abs(depth) > EPS ? Math.sign(depth) : fallback;
      const requested = Math.min(4, Math.max(2.8, g.width * 0.75)) * runScale;
      // A short anchor must not be passed by the normal throat: doing so
      // sends the path away from the gate and then back over itself.
      const run = Math.abs(depth)>EPS ? Math.min(requested,Math.abs(depth)*.75) : requested;
      return new Point(g.center.x + nx * sign * run, g.center.y + ny * sign * run);
    };
    for (const scale of [1, .65, .4, .3]) {
      runScale = scale; next = [];
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        const cuts: { t: number; point: Point; gate?: GateSite }[] = [{ t: 0, point: a, gate: at.get(pointKey(a)) }, { t: 1, point: b, gate: at.get(pointKey(b)) }];
        for (const g of sites) {
          const hit = intersection(a, b, g.a, g.b);
          if (hit && hit[0] > EPS && hit[0] < 1 - EPS && distance(mixPoint(a, b, hit[0]), g.original) < EPS) cuts.push({ t: hit[0], point: g.original, gate: g });
        }
        cuts.sort((x, y) => x.t - y.t);
        for (let j = 1; j < cuts.length; j++) {
          const left = cuts[j - 1], right = cuts[j];
          push(left.gate?.center ?? left.point);
          if (left.gate) push(throat(left.gate, right.point, boundarySide));
          if (right.gate) push(throat(right.gate, left.point, boundarySide));
          push(right.gate?.center ?? right.point);
        }
      }
      dry = true;
      if (next.length !== path.length || next.some((p, i) => distance(p, path[i]) > EPS)) {
        // Shore roads may already touch a water boundary. Only added/replaced
        // spans must be dry; unchanged shore spans and bridges retain geometry.
        for (let i = 1; i < next.length; i++) {
          if (path.slice(1).some((p, j) => distance(path[j], next[i - 1]) < EPS && distance(p, next[i]) < EPS)) continue;
          const parts = splitSegment(next[i - 1], next[i], waterCuts);
          if (parts.slice(1).some((p, j) => waterCuts.some(c => inRing(c, mixPoint(parts[j], p, .5))))) { dry = false; break; }
        }
      }
      if (dry) break;
    }
    if (!dry) throw new RetryableError('A gate approach would cross water');
    if (next.length !== path.length || next.some((p, i) => distance(p, path[i]) > EPS)) { path.splice(0, path.length, ...next); changed.add(path); }
  }
  // Bends can meet existing streets away from their old parcel junctions.
  // Split both roads there so every drawn crossing is also a graph junction.
  smoothGateRoads(paths,changed,sites.map(s=>s.center),widths,waterCuts);
  const segments = paths.flatMap(path => path.slice(1).map((b, i) => ({ path, i, a: path[i], b, cuts: [] as { t: number; point: Point }[] })));
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const a = segments[i], b = segments[j];
    if ((!changed.has(a.path) && !changed.has(b.path)) || a.path === b.path || excluded.has(a.path) || excluded.has(b.path)) continue;
    if (Math.max(a.a.x, a.b.x) < Math.min(b.a.x, b.b.x) - EPS || Math.max(b.a.x, b.b.x) < Math.min(a.a.x, a.b.x) - EPS || Math.max(a.a.y, a.b.y) < Math.min(b.a.y, b.b.y) - EPS || Math.max(b.a.y, b.b.y) < Math.min(a.a.y, a.b.y) - EPS) continue;
    const hit = intersection(a.a, a.b, b.a, b.b); if (!hit) continue;
    const point = canonical(mixPoint(a.a, a.b, hit[0]));
    if (hit[0] > EPS && hit[0] < 1 - EPS) a.cuts.push({ t: hit[0], point });
    if (hit[1] > EPS && hit[1] < 1 - EPS) b.cuts.push({ t: hit[1], point });
  }
  for (const path of paths) {
    const next = segments.filter(s => s.path === path).flatMap(s => [s.a, ...s.cuts.sort((a, b) => a.t - b.t).map(c => c.point)]);
    next.push(path.at(-1)!);
    path.splice(0, path.length, ...next.filter((p, i) => !i || distance(p, next[i - 1]) > EPS));
  }
}

export function planGateApproaches(model: Model, waterCuts: Point2[][], bridges: Polygon[]): void {
  const ring = model.cityEnvelope;
  const paths = [...model.streets, ...model.roads], excluded = new Set(bridges), candidates = new Map<string, GateSite>();
  const castle = model.citadel?.ward?.wall;
  if (castle) {
    const sites = castle.gates.map(center => {
      const i = castle.shape.indexOf(center), count = castle.shape.length;
      const width = clamp(Math.max(0, ...paths.filter(p => p.includes(center)).map(p => model.roadWidths.get(p) ?? 2)) + 1, CASTLE_GATE_WIDTH.min, CASTLE_GATE_WIDTH.max);
      const hosts = castle.shape.map((_, edge) => {
        let left = edge, right = (left + 1) % count;
        const a = castle.shape[left], b = castle.shape[right];
        for (let guard = 0; guard < count; guard++) {
          const p = (left + count - 1) % count;
          if (Math.abs(side(a, b, castle.shape[p])) > EPS || p === right) break; left = p;
        }
        for (let guard = 0; guard < count; guard++) {
          const p = (right + 1) % count;
          if (Math.abs(side(a, b, castle.shape[p])) > EPS || p === left) break; right = p;
        }
        const start = castle.shape[left], end = castle.shape[right], length = distance(start, end);
        const projection = ((center.x - start.x) * (end.x - start.x) + (center.y - start.y) * (end.y - start.y)) / length;
        const t = clamp(projection, width / 2 + 1, length - width / 2 - 1);
        const point = mixPoint(start, end, t / length), nx = -(end.y - start.y) / length, ny = (end.x - start.x) / length;
        const dry = [-1, 1].every(s => !waterCuts.some(c => inRing(c, { x: point.x + nx * s * 2.8, y: point.y + ny * s * 2.8 })));
        const neighbor = model.patches.find(p => p !== model.citadel && p.shape.findEdge(b, a) >= 0)?.withinCity ?? false;
        return { a: start, b: end, point, length, dry, neighbor };
      }).filter(h => h.length >= width + 2 - EPS && distance(h.point, center) <= 8 + EPS).sort((a, b) => Number(b.dry) - Number(a.dry) || Number(b.neighbor) - Number(a.neighbor) || distance(a.point, center) - distance(b.point, center));
      const host = hosts[0]; if (!host) throw new RetryableError('Castle gate needs a straight wall face of sufficient length');
      return { original: center, center: host.point, a: host.a, b: host.b, edge: i, width, inside: true, outside: true };
    });
    // Preserve the old corner junction. Split the host street at the chosen
    // straight face, then bend that street outside the castle to the entrance.
    // Moving every road at the old corner would cut diagonally across the keep.
    for (const site of sites) {
      let attached = false;
      for (const path of paths) if (!excluded.has(path)) {
        const next: Point[] = [];
        for (let j = 1; j < path.length; j++) {
          const a = path[j - 1], b = path[j]; next.push(a);
          if (Math.abs(distance(a, site.center) + distance(site.center, b) - distance(a, b)) < EPS) {
            attached = true;
            if (distance(a, site.center) > EPS && distance(b, site.center) > EPS) next.push(site.center);
          }
        }
        next.push(path.at(-1)!); path.splice(0, path.length, ...next);
      }
      if (!attached) {
        const connector = new Polygon([site.original, site.center]);
        model.streets.push(connector); model.arteries.push(connector); paths.push(connector);
        model.roadWidths.set(connector, Math.min(2, site.width - 1));
      }
    }
    const actualSites = sites.map(g => ({ ...g, original: g.center }));
    turnApproaches(paths, actualSites, waterCuts, excluded, model.roadWidths, -1);
    actualSites.forEach((g, i) => { sites[i].center = g.center; });
    // Two tangent street legs can share one forecourt. Express the entrance as
    // its own branch instead of traversing the same throat out and back in a
    // single polyline (which would create duplicate road faces in Blender).
    for (const group of [model.streets, model.roads]) for (const path of [...group]) for (let i = 1; i < path.length - 1; i++) {
      const gate = sites.find(g => g.center === path[i]);
      if (!gate || path[i - 1] !== path[i + 1]) continue;
      const branch = new Polygon([path[i - 1], path[i]]);
      group.push(branch); paths.push(branch); if (group === model.streets) model.arteries.push(branch);
      model.roadWidths.set(branch, Math.min(model.roadWidths.get(path) ?? 2, gate.width - 1));
      path.splice(i, 2); i--;
    }
    sites.forEach((site, i) => {
      castle.gates[i] = site.center;
      model.gates = model.gates.map(p => p === site.original ? site.center : p);
      if (!model.gates.includes(site.center)) model.gates.push(site.center);
      if (castle.shape.includes(site.center)) return;
      const edge = castle.shape.findIndex((a, j) => {
        const b = castle.shape[(j + 1) % castle.shape.length];
        return Math.abs(distance(a, site.center) + distance(site.center, b) - distance(a, b)) < EPS;
      });
      if (edge < 0) throw new RetryableError('Castle gate cannot be attached to its chosen wall face');
      castle.shape.splice(edge + 1, 0, site.center); castle.segments.splice(edge + 1, 0, castle.segments[edge]);
    });
    castle.buildTowers();
    // Only the short throat narrows when a main street reaches the smaller
    // castle entrance. Keep the remote street's width and all graph nodes.
    for (const group of [model.streets, model.roads]) for (const path of [...group]) {
      const width = model.roadWidths.get(path) ?? 2;
      const chunks: { points: Point[]; width: number }[] = [];
      for (let i = 1; i < path.length; i++) {
        const gate = sites.find(g => g.center === path[i - 1] || g.center === path[i]);
        const local = gate ? Math.min(width, gate.width - 1) : width;
        if (chunks.at(-1)?.width === local) chunks.at(-1)!.points.push(path[i]);
        else chunks.push({ points: [path[i - 1], path[i]], width: local });
      }
      chunks.forEach((chunk, i) => {
        const target = i ? new Polygon(chunk.points) : path;
        if (!i) target.splice(0, target.length, ...chunk.points);
        else { group.push(target); paths.push(target); if (group === model.streets) model.arteries.push(target); }
        model.roadWidths.set(target, chunk.width);
      });
    }
  }
  if (!ring) return;
  // Predict the same attachment used at export, while there are no buildings
  // yet. Gate placement must leave the city/castle wall junctions solid.
  const junctions: Point2[] = [];
  if (castle) {
    const vertices: Vertex[] = [], ids = new Map<string, string>();
    const id = (p: Point2) => { const key = pointKey(p); let value = ids.get(key); if (!value) { value = `v${vertices.length}`; vertices.push({ id: value, x: p.x, y: p.y }); ids.set(key, value); } return value; };
    const cityBoundary: string[] = [], cityActive: boolean[] = [];
    ring.forEach((a, i) => {
      const parts = splitSegment(a, ring[(i + 1) % ring.length], waterCuts);
      parts.slice(1).forEach((b, j) => { cityBoundary.push(id(parts[j])); cityActive.push(!waterCuts.some(c => inRing(c, mixPoint(parts[j], b, .5)))); });
    });
    const gates = castle.gates.map((p, i) => ({ id: `g${i}`, wallId: 'castle', vertexId: id(p) }));
    const walls = [
      { id: 'city', kind: 'city' as const, boundary: cityBoundary, activeSegments: cityActive, gateIds: [], towerVertexIds: [] },
      { id: 'castle', kind: 'castle' as const, boundary: castle.shape.map(id), activeSegments: [...castle.segments], gateIds: gates.map(g => g.id), towerVertexIds: [] },
    ];
    connectCastleToCityWall({ vertices, walls, gates, buildings: [], districts: [] }, waterCuts);
    const cityIds = new Set(walls[0].boundary), v = new Map(vertices.map(p => [p.id, p]));
    walls[1].boundary.forEach((key, i, all) => {
      if (cityIds.has(key) && walls[1].activeSegments[i] !== walls[1].activeSegments[(i + all.length - 1) % all.length]) junctions.push(v.get(key)!);
    });
  }
  const roadSide = (p: Point2) => {
    const value = Math.min(...ring.map((a, i) => side(a, ring[(i + 1) % ring.length], p)));
    return value > EPS ? 1 : value < -EPS ? -1 : 0;
  };
  for (const path of paths) if (!excluded.has(path)) for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], width = model.roadWidths.get(path) ?? 2;
    ring.forEach((c, edge) => {
      const d = ring[(edge + 1) % ring.length], hit = intersection(a, b, c, d); if (!hit) return;
      const point = mixPoint(a, b, hit[0]); if (waterCuts.some(cut => inRing(cut, point))) return;
      const sides = [roadSide(mixPoint(point, a, .01)), roadSide(mixPoint(point, b, .01))];
      const previous = candidates.get(pointKey(point));
      const target = width + 1;
      if (target > CITY_GATE_WIDTH.max + EPS) throw new RetryableError('A road is too wide for the maximum city gate width');
      if (previous) {
        previous.width = Math.max(previous.width, target);
        previous.inside ||= sides.includes(1); previous.outside ||= sides.includes(-1);
      } else candidates.set(pointKey(point), { original: point, center: point, a: c, b: d, edge, width: clamp(target, CITY_GATE_WIDTH.min, CITY_GATE_WIDTH.max), inside: sides.includes(1), outside: sides.includes(-1) });
    });
  }
  const sites = [...candidates.values()].filter(g => g.inside && g.outside);
  spaceGates(sites, ring, junctions);
  turnApproaches(paths, sites, waterCuts, excluded, model.roadWidths);
  // A short normal throat must cross this wall only at its own gate. Reject
  // unsafe corner bends instead of silently opening another/wider gap.
  for (const path of paths) if (!excluded.has(path)) for (let i = 1; i < path.length; i++) ring.forEach((a, edge) => {
    const b = ring[(edge + 1) % ring.length], hit = intersection(path[i - 1], path[i], a, b); if (!hit) return;
    const p = mixPoint(path[i - 1], path[i], hit[0]);
    if (waterCuts.some(cut => inRing(cut, p)) || hit[0] < EPS || hit[0] > 1 - EPS) return;
    if (!sites.some(g => distance(g.center, p) < EPS)) throw new RetryableError('A gate bend crosses a different solid wall span');
  });
}

/** Materialize castle openings in the 2D topology as well. Shared city spans
 * remain owned by the city; no opening may spill into a shared span/corner. */
export function openCastleGates(town: TownData): void {
  const vertices = new Map(town.vertices.map(v => [v.id, v]));
  const add = (p: Point2): Vertex => {
    const old = town.vertices.find(v => distance(p, v) < EPS); if (old) return old;
    const v = { id: `v${town.vertices.length}`, x: p.x, y: p.y }; town.vertices.push(v); vertices.set(v.id, v); return v;
  };
  for (const wall of town.walls.filter(w => w.kind === 'castle')) {
    const cuts = new Map<number, { t: number; vertex: Vertex }[]>(), openings = new Map<number, [number, number][]>();
    for (const gate of town.gates.filter(g => g.wallId === wall.id)) {
      const i = wall.boundary.indexOf(gate.vertexId), count = wall.boundary.length;
      const widths = town.roads.filter(r => r.vertexIds.includes(gate.vertexId)).map(r => r.width);
      const width = clamp(Math.max(0, ...widths) + 1, CASTLE_GATE_WIDTH.min, CASTLE_GATE_WIDTH.max), half = width / 2;
      for (const direction of [-1, 1]) {
        let current = i, remaining = half;
        for (let guard = 0; remaining > EPS && guard < count; guard++) {
          const edge = direction === 1 ? current : (current + count - 1) % count;
          if (!wall.activeSegments[edge]) throw new RetryableError('Castle gate would extend into a shared wall or water gap');
          const a = vertices.get(wall.boundary[edge])!, b = vertices.get(wall.boundary[(edge + 1) % count])!, length = distance(a, b);
          const fraction = Math.min(1, remaining / length), lo = direction === 1 ? 0 : 1 - fraction, hi = direction === 1 ? fraction : 1;
          openings.set(edge, [...(openings.get(edge) ?? []), [lo, hi]]);
          if (fraction < 1 - EPS) {
            const t = direction === 1 ? hi : lo;
            cuts.set(edge, [...(cuts.get(edge) ?? []), { t, vertex: add(mixPoint(a, b, t)) }]);
          }
          remaining -= length; current = (current + count + direction) % count;
        }
        if (remaining > EPS) throw new RetryableError('Castle gate cannot consume its entire wall');
      }
    }
    const boundary: string[] = [], active: boolean[] = [];
    for (let i = 0; i < wall.boundary.length; i++) {
      const a = vertices.get(wall.boundary[i])!, b = vertices.get(wall.boundary[(i + 1) % wall.boundary.length])!;
      const parts = [{ t: 0, vertex: a }, ...(cuts.get(i) ?? []).sort((a, b) => a.t - b.t), { t: 1, vertex: b }].filter((p, j, all) => !j || p.t - all[j - 1].t > EPS);
      for (let j = 1; j < parts.length; j++) {
        boundary.push(parts[j - 1].vertex.id);
        const t = (parts[j - 1].t + parts[j].t) / 2;
        active.push(wall.activeSegments[i] && !(openings.get(i) ?? []).some(([lo, hi]) => t > lo - EPS && t < hi + EPS));
      }
    }
    wall.boundary = boundary; wall.activeSegments = active;
  }
}

/** Generation invariant, intentionally separate from the backwards-compatible
 * JSON validator. Imported old plans must retain their original geometry. */
export function validateGeneratedGates(town: TownData): void {
  const vertices = new Map(town.vertices.map(v => [v.id, v]));
  for (const wall of town.walls) for (const gate of town.gates.filter(g => g.wallId === wall.id)) {
    const count = wall.boundary.length, i = wall.boundary.indexOf(gate.vertexId);
    let left = i, right = i, length = 0, guard = 0;
    const members = new Set([gate.vertexId]);
    while (!wall.activeSegments[(left + count - 1) % count] && guard++ < count) {
      const next = (left + count - 1) % count;
      length += distance(vertices.get(wall.boundary[left])!, vertices.get(wall.boundary[next])!); left = next; members.add(wall.boundary[left]);
    }
    guard = 0;
    while (!wall.activeSegments[right] && guard++ < count) {
      const next = (right + 1) % count;
      length += distance(vertices.get(wall.boundary[right])!, vertices.get(wall.boundary[next])!); right = next; members.add(wall.boundary[right]);
    }
    const range = wall.kind === 'city' ? CITY_GATE_WIDTH : CASTLE_GATE_WIDTH;
    if (length < range.min - EPS || length > range.max + EPS) throw new RetryableError('Final gate opening is outside its width limits');
    if (town.gates.some(g => g.wallId === wall.id && g.id !== gate.id && members.has(g.vertexId))) throw new RetryableError('Distinct adjacent gates cannot share a merged opening');
    const a = vertices.get(wall.boundary[left])!, b = vertices.get(wall.boundary[right])!, span = distance(a, b);
    let attached = false;
    for (const road of town.roads) for (let j = 0; j < road.vertexIds.length; j++) if (road.vertexIds[j] === gate.vertexId) {
      attached = true;
      const p = vertices.get(gate.vertexId)!;
      for (const k of [j - 1, j + 1].filter(k => k >= 0 && k < road.vertexIds.length)) {
        const q = vertices.get(road.vertexIds[k])!, sine = Math.abs((q.x - p.x) * (b.y - a.y) - (q.y - p.y) * (b.x - a.x)) / distance(p, q) / span;
        if (sine < Math.cos(Math.PI / 12) - EPS) throw new RetryableError(`Gate ${gate.id} (${wall.kind}) approach is more than fifteen degrees from perpendicular`);
        if (road.width / sine + .5 > length + EPS) throw new RetryableError('A gate opening is narrower than its road clearance');
      }
    }
    if (!attached) throw new RetryableError('A gate is detached from the road graph');
    let pier = 0, cursor = right; guard = 0;
    while (wall.activeSegments[cursor] && guard++ < count) {
      const next = (cursor + 1) % count;
      pier += distance(vertices.get(wall.boundary[cursor])!, vertices.get(wall.boundary[next])!); cursor = next;
    }
    if (pier < MIN_GATE_PIER - EPS) {
      const nextOpening = new Set<string>(); guard = 0;
      while (!wall.activeSegments[cursor] && guard++ < count) { nextOpening.add(wall.boundary[cursor]); cursor = (cursor + 1) % count; }
      if (town.gates.some(g => g.wallId === wall.id && g.id !== gate.id && nextOpening.has(g.vertexId))) throw new RetryableError('Adjacent gates need a full separating wall pier');
    }
  }
  for (const wall of town.walls) for (let i = 0; i < wall.boundary.length; i++) if (wall.activeSegments[i]) {
    const a = vertices.get(wall.boundary[i])!, b = vertices.get(wall.boundary[(i + 1) % wall.boundary.length])!;
    for (const road of town.roads) for (let j = 1; j < road.vertexIds.length; j++) {
      const c = vertices.get(road.vertexIds[j - 1])!, d = vertices.get(road.vertexIds[j])!;
      if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - EPS || Math.max(c.x, d.x) < Math.min(a.x, b.x) - EPS || Math.max(a.y, b.y) < Math.min(c.y, d.y) - EPS || Math.max(c.y, d.y) < Math.min(a.y, b.y) - EPS) continue;
      const hit = intersection(a, b, c, d);
      if (hit && hit.every(t => t > EPS && t < 1 - EPS)) throw new RetryableError('A gate approach crosses a solid wall outside its opening');
    }
  }
}
