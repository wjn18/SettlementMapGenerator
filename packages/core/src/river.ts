import { Random } from './context.js';
import type { TownData, River, Point2 } from './types.js';

const lerp = (a: Point2, b: Point2, t: number): Point2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
function segmentDistance(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function distanceToPath(p: Point2, path: readonly Point2[]): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) best = Math.min(best, segmentDistance(p, path[i - 1], path[i]));
  return best;
}
function cross(a: Point2, b: Point2, p: Point2): number { return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); }
function segmentsDistance(a: Point2, b: Point2, c: Point2, d: Point2): number {
  if (cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0 &&
    Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
    Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))) return 0;
  return Math.min(segmentDistance(a, c, d), segmentDistance(b, c, d), segmentDistance(c, a, b), segmentDistance(d, a, b));
}
function contains(ring: readonly Point2[], p: Point2): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function polygonTouchesRiver(ring: readonly Point2[], river: Pick<River, 'centerline' | 'width' | 'bankWidth'>, clearance = 0): boolean {
  const radius = river.width / 2 + river.bankWidth + clearance;
  for (let i = 1; i < river.centerline.length; i++) {
    const a = river.centerline[i - 1], b = river.centerline[i];
    if (contains(ring, a)) return true;
    for (let j = 0; j < ring.length; j++) if (segmentsDistance(a, b, ring[j], ring[(j + 1) % ring.length]) <= radius) return true;
  }
  return contains(ring, river.centerline.at(-1)!);
}

/** Split paths at the bank. Dense sampling brackets crossings, then bisection refines them. */
function splitPath(path: Point2[], river: River, margin = 0): { inside: boolean; points: Point2[] }[] {
  const radius = river.width / 2 + river.bankWidth + margin;
  const wet = (p: Point2) => distanceToPath(p, river.centerline) < radius;
  const pieces = [{ inside: wet(path[0]), points: [path[0]] }];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], n = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) / (river.width / 5)));
    let previous = a;
    for (let step = 1; step <= n; step++) {
      const p = lerp(a, b, step / n), inside = wet(p), current = pieces.at(-1)!;
      if (inside !== current.inside) {
        let left = previous, right = p;
        for (let k = 0; k < 24; k++) { const mid = lerp(left, right, 0.5); if (wet(mid) === current.inside) left = mid; else right = mid; }
        const boundary = lerp(left, right, 0.5);
        current.points.push(boundary); pieces.push({ inside, points: [boundary] });
      }
      previous = p;
    }
    pieces.at(-1)!.points.push(b);
  }
  return pieces;
}

/** Deterministic terrain pass. Dry-town generation and its RNG sequence are unchanged. */
export function addRiver(town: TownData): void {
  const index = new Map(town.vertices.map(v => [v.id, v]));
  const points = (ids: string[]): Point2[] => ids.map(id => index.get(id)!);
  const city = town.districts.filter(d => d.withinCity).flatMap(d => points(d.boundary));
  const minX = Math.min(...city.map(p => p.x)), maxX = Math.max(...city.map(p => p.x));
  const minY = Math.min(...city.map(p => p.y)), maxY = Math.max(...city.map(p => p.y));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, radius = Math.max(maxX - minX, maxY - minY) / 2;
  const random = new Random((town.resolved.seed % 2147483645) + 1);
  const protectedRings = town.districts.filter(d => d.wardType === 'Castle' || d.id === town.districts.find(d => d.wardType === 'Market')?.id).map(d => points(d.boundary));
  const width = Math.max(5, Math.min(16, radius * 0.09)), bankWidth = Math.max(0.8, width * 0.12);
  let selected: River | undefined, best = Infinity;
  const roadPaths = town.roads.map(r => points(r.vertexIds));
  for (let candidate = 0; candidate < 64; candidate++) {
    const horizontal = candidate % 2 === 0, phase = random.float() * Math.PI * 2;
    const offset = (random.float() - 0.5) * radius * 0.8, slope = (random.float() - 0.5) * 0.65;
    const start = horizontal ? town.bounds.minX : town.bounds.minY, end = horizontal ? town.bounds.maxX : town.bounds.maxY;
    const center = horizontal ? cx : cy;
    const line = Array.from({ length: 97 }, (_, i) => {
      const along = start + (end - start) * i / 96;
      const across = (horizontal ? cy : cx) + offset + (along - center) * slope + Math.sin((along - center) / radius * 1.7 + phase) * radius * 0.16;
      return horizontal ? { x: along, y: Math.max(town.bounds.minY, Math.min(town.bounds.maxY, across)) } : { x: Math.max(town.bounds.minX, Math.min(town.bounds.maxX, across)), y: along };
    });
    const river: River = { centerline: line, width, bankWidth, bridges: [] };
    const protectedHits = protectedRings.filter(ring => polygonTouchesRiver(ring, river, width)).length;
    const gateHits = town.gates.filter(g => distanceToPath(index.get(g.vertexId)!, line) < width * 1.5).length;
    const centerDistance = distanceToPath(town.center, line);
    const wetEndpoints = roadPaths.filter(path => [path[0], path.at(-1)!].some(p => distanceToPath(p, line) < width / 2 + bankWidth + 1)).length;
    const crossing = roadPaths.some(path => path.slice(1).some((p, i) => line.slice(1).some((q, j) => segmentsDistance(path[i], p, line[j], q) === 0)));
    const score = wetEndpoints * 10000000 + protectedHits * 1000000 + (crossing ? 0 : 100000) + gateHits * 10000 + (centerDistance < width * 2 ? 1000 : 0) + Math.abs(centerDistance - radius * 0.28);
    if (score < best) { best = score; selected = river; }
  }
  const river = selected!;
  // Remove whole intersecting footprints; never leave half a building in the channel.
  town.buildings = town.buildings.filter(b => !polygonTouchesRiver(points(b.boundary), river, 0.4));
  town.features = town.features.filter(b => !polygonTouchesRiver(points(b.boundary), river, 0.4));
  const bridgeKeys = new Set<string>();
  for (const road of town.roads) {
    for (const piece of splitPath(points(road.vertexIds), river, 0.7)) {
      if (!piece.inside || piece.points.length < 2) continue;
      // A bridge is needed only if the road actually reaches the water, not just the bank.
      const touches = piece.points.some(p => distanceToPath(p, river.centerline) < width / 2) || piece.points.slice(1).some((p, i) => {
        for (let j = 1; j < river.centerline.length; j++) if (segmentsDistance(piece.points[i], p, river.centerline[j - 1], river.centerline[j]) < width / 2) return true;
        return false;
      });
      if (!touches) continue;
      const forward = piece.points.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';');
      const backward = [...piece.points].reverse().map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';');
      if (bridgeKeys.has(forward) || bridgeKeys.has(backward)) continue;
      bridgeKeys.add(forward);
      river.bridges.push({ id: `bridge${river.bridges.length}`, roadId: road.id, points: piece.points.map(p => ({ x: p.x, y: p.y })), width: road.width * 1.6 });
    }
  }
  // Insert bank vertices into wall rings and open only the portions crossing water.
  let nextVertex = town.vertices.length;
  const vertex = (p: Point2): string => {
    const id = `v${nextVertex++}`; town.vertices.push({ id, x: p.x, y: p.y }); return id;
  };
  for (const wall of town.walls) {
    const original = [...wall.boundary], boundary: string[] = [], active: boolean[] = [];
    for (let i = 0; i < original.length; i++) {
      const a = index.get(original[i])!, b = index.get(original[(i + 1) % original.length])!;
      const pieces = splitPath([a, b], river, 0.25);
      for (let j = 0; j < pieces.length; j++) {
        boundary.push(j === 0 ? original[i] : vertex(pieces[j].points[0]));
        active.push(wall.activeSegments[i] && !pieces[j].inside);
      }
    }
    wall.boundary = boundary; wall.activeSegments = active;
    wall.towerVertexIds = wall.towerVertexIds.filter(id => distanceToPath(index.get(id)!, river.centerline) > width / 2 + bankWidth + 3);
    wall.gateIds = wall.gateIds.filter(id => {
      const gate = town.gates.find(g => g.id === id)!;
      return distanceToPath(index.get(gate.vertexId)!, river.centerline) > width / 2 + bankWidth + 3;
    });
  }
  const retainedGates = new Set(town.walls.flatMap(w => w.gateIds));
  const removedVertices = new Set(town.gates.filter(g => !retainedGates.has(g.id)).map(g => g.vertexId));
  town.gates = town.gates.filter(g => retainedGates.has(g.id));
  town.entrances = town.entrances.filter(id => !removedVertices.has(id));
  town.river = river;
}
