import { inRing, intersection, mixPoint, positiveRing, splitSegment } from './terrain-geometry.js';
import { distanceToPath } from './river.js';
import type { Point2, River, Dock, RiverHarborPlan, TownData } from './types.js';

const dist = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);
const add = (a: Point2, b: Point2, k: number): Point2 => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const plain = (p: Point2): Point2 => ({ x: p.x, y: p.y });
export function harborRectangle(a: Point2, b: Point2, width: number): Point2[] {
  const length = dist(a, b), n = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  return positiveRing([add(a, n, width / 2), add(a, n, -width / 2), add(b, n, -width / 2), add(b, n, width / 2)]).map(plain);
}
export function berthFootprint(berth: RiverHarborPlan['berth']): Point2[] {
  const u = { x: Math.cos(berth.heading), y: Math.sin(berth.heading) };
  return harborRectangle(add(berth.center, u, -berth.length / 2), add(berth.center, u, berth.length / 2), berth.beam);
}
const edges = (ring: Point2[]) => ring.map((a, i) => [a, ring[(i + 1) % ring.length]] as const);
export function harborInside(ring: Point2[], water: Point2[]): boolean {
  const inside = (p: Point2) => inRing(water, p) || distanceToPath(p, [...water, water[0]]) < 1e-6;
  return edges(ring).every(([a, b]) => {
    const parts = splitSegment(a, b, [water]);
    return parts.every(inside) && parts.slice(1).every((p, i) => inside(mixPoint(parts[i], p, .5)));
  });
}
function withinBank(ring: Point2[], river: River): boolean {
  const water = river.surface!, boundary = [...water, water[0]];
  return edges(ring).every(([a, b]) => Array.from({ length: 17 }, (_, i) => mixPoint(a, b, i / 16)).every(p => inRing(water, p) || distanceToPath(p, boundary) <= river.bankWidth));
}
export function harborOverlap(a: Point2[], b: Point2[], margin = 0): boolean {
  if (a.some(p => inRing(b, p)) || b.some(p => inRing(a, p))) return true;
  if (edges(a).some(([p, q]) => edges(b).some(([r, s]) => intersection(p, q, r, s)))) return true;
  return a.some(p => distanceToPath(p, [...b, b[0]]) <= margin) || b.some(p => distanceToPath(p, [...a, a[0]]) <= margin);
}
function project(p: Point2, path: Point2[]): { point: Point2; station: number } {
  let result = { point: path[0], station: 0 }, best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], square = dist(a, b) ** 2;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / square));
    const q = mixPoint(a, b, t), d = dist(p, q);
    if (d < best) { best = d; result = { point: plain(q), station: i - 1 + t }; }
  }
  return result;
}
export function dockFootprints(dock: Pick<Dock, 'points' | 'width'>): Point2[][] {
  return dock.points.slice(1).map((p, i) => harborRectangle(dock.points[i], p, dock.width));
}
export interface RiverHarborCandidate { shoreIndex: number; points: Point2[]; width: number; riverHarbor: RiverHarborPlan }

/** Plan in the same pre-export units as terrain. Keep berths and reserved routes
 * outside bridge footprints; static arches do not imply simulated navigation. */
export function planRiverHarbors(river: River, shores: { path: Point2[]; eligible: boolean }[], bridges: Point2[][], sea: Point2[] | undefined, count: number, protectedLand: Point2[][] = []): RiverHarborCandidate[] {
  const water = river.surface!, center = river.centerline;
  const barriers = bridges.flatMap(path => path.map(p => project(p, center).station));
  const first = Math.min(...barriers), last = Math.max(...barriers);
  const obstacles = bridges.flatMap(points => dockFootprints({ points, width: 6 }));
  const candidates: (RiverHarborCandidate & { score: number })[] = [];
  const sailboats = [
    { boat: 'cargo-sloop' as const, length: 9.6, beam: 3.2 },
    { boat: 'cargo-ketch' as const, length: 10.4, beam: 3.6 },
    { boat: 'cargo-lugger' as const, length: 9.2, beam: 3.8 },
  ];
  const channels = new Map<number, Point2[][]>();
  shores.forEach((shore, shoreIndex) => {
    if (!shore.eligible) return;
    for (let segment = 1; segment < shore.path.length; segment++) {
      const a = shore.path[segment - 1], b = shore.path[segment], span = dist(a, b);
      if (span < 1.2) continue;
      const u = { x: (b.x - a.x) / span, y: (b.y - a.y) / span };
      for (const t of [.5, .25, .75]) {
        const start = plain(mixPoint(a, b, t));
        let n = { x: -u.y, y: u.x };
        if (dist(add(start, n, river.bankWidth), project(start, center).point) > dist(add(start, n, -river.bankWidth), project(start, center).point)) n = { x: -n.x, y: -n.y };
        const rayEnd = add(start, n, river.width * 3 + river.bankWidth * 2);
        const hits = edges(water).flatMap(([c, d]) => { const hit = intersection(start, rayEnd, c, d); return hit ? [hit[0]] : []; }).sort((x, y) => x - y);
        if (!hits.length) continue;
        const bank = mixPoint(start, rayEnd, hits[0]);
        // Cargo-sized berths are planned before subdivision, not enlarged into
        // the channel afterwards. Prefer the larger vessel over a nearer berth.
        const sailboat = sailboats[(shoreIndex + Math.round(Math.abs(a.x + a.y))) % sailboats.length];
        for (const vessel of [{ boat: 'cargo' as const, length: 7.2, beam: 2.3 }, { boat: 'cargo' as const, length: 6.4, beam: 2.05 }, sailboat]) for (const sign of [1, -1]) {
          const width = 1.35, run = vessel.length + 1.8;
          const elbow = add(bank, n, -.45), end = add(elbow, u, sign * run);
          const c = add(add(elbow, u, sign * run / 2), n, width / 2 + vessel.beam / 2 + .35);
          const berth = { id: '', ...vessel, center: c, heading: Math.atan2(u.y * sign, u.x * sign) };
          const station = project(c, center);
          const exit = station.station < first ? 'start' : station.station > last ? 'end' : null;
          if (!exit) continue;
          const tail = exit === 'start' ? center.slice(0, Math.floor(station.station) + 1).reverse() : center.slice(Math.ceil(station.station));
          const route = [c, station.point, ...tail].filter((p, i, all) => !i || dist(p, all[i - 1]) > 1e-6).map(plain);
          const navigation: RiverHarborPlan['navigation'] = { points: route, width: vessel.beam + .5, exit };
          const tip = route.at(-1)!, before = route.at(-2)!;
          route[route.length - 1] = plain(mixPoint(tip, before, Math.min(.9, navigation.width / dist(tip, before))));
          const points = [start, elbow, end], footprint = berthFootprint(berth), deck = dockFootprints({ points, width });
          const navigable = dockFootprints({ points: route, width: navigation.width });
          if (!harborInside(footprint, water) || !withinBank(deck[1], river)) continue;
          if (sea && [footprint, ...deck].some(r => harborOverlap(r, sea, .6))) continue;
          if ([footprint, ...deck, ...navigable].some(r => obstacles.some(o => harborOverlap(r, o, .5)))) continue;
          if (navigable.some(r => !harborInside(r, water) || deck.some(d => harborOverlap(r, d, .1)))) continue;
          // Keep the longitudinal channel clear, including the other bank.
          if (!channels.has(navigation.width)) channels.set(navigation.width, center.slice(1).map((p, i) => harborRectangle(center[i], p, navigation.width)));
          const channel = channels.get(navigation.width)!;
          if ([footprint, ...deck].some(r => channel.some(q => harborOverlap(r, q, .15)))) continue;
          const yard = harborRectangle(add(start, u, -2.8), add(start, u, 2.8), 6.4).map(p => add(p, n, -2.9));
          if (protectedLand.some(p => harborOverlap(p, yard))) continue;
          candidates.push({ shoreIndex, points, width, riverHarbor: { version: 1, layout: 'along-bank', berth, yard, navigation }, score: (sea && exit === 'end' ? -10000 : 0) + (vessel.boat === 'cargo' ? (7.2 - vessel.length) * 5000 : 0) + dist(start, { x: 0, y: 0 }) });
        }
      }
    }
  });
  candidates.sort((a, b) => a.score - b.score);
  const chosen: RiverHarborCandidate[] = [];
  const compatible = (candidate: RiverHarborCandidate, other: RiverHarborCandidate): boolean => {
    const footprint = [...dockFootprints(candidate), berthFootprint(candidate.riverHarbor.berth), candidate.riverHarbor.yard];
    return !(dist(candidate.points[0], other.points[0]) < 14 || footprint.some(r => [...dockFootprints(other), berthFootprint(other.riverHarbor.berth)].some(q => harborOverlap(r, q, 1)))
      || dockFootprints({ points: other.riverHarbor.navigation.points, width: other.riverHarbor.navigation.width }).some(q => footprint.some(r => harborOverlap(r, q, .1)))
      || dockFootprints({ points: candidate.riverHarbor.navigation.points, width: candidate.riverHarbor.navigation.width }).some(q => [...dockFootprints(other), berthFootprint(other.riverHarbor.berth)].some(r => harborOverlap(r, q, .1))));
  };
  // A port starts as a verified mixed pair, then expands when space permits.
  for (const cargo of candidates.filter(c => c.riverHarbor.berth.boat === 'cargo')) {
    const sailboat = candidates.filter(c => c.riverHarbor.berth.boat !== 'cargo').sort((a,b) => dist(a.points[0], cargo.points[0]) - dist(b.points[0], cargo.points[0])).find(c => compatible(c, cargo));
    if (sailboat) { chosen.push(cargo, sailboat); break; }
  }
  if (!chosen.length) return [];
  while (chosen.length < count) {
    const types = new Set(chosen.map(c => c.riverHarbor.berth.boat));
    const next = candidates.filter(c => chosen.every(other => compatible(c, other)))
      .sort((a,b) => Number(types.has(a.riverHarbor.berth.boat)) - Number(types.has(b.riverHarbor.berth.boat)) || a.score-b.score)[0];
    if (!next) break;
    chosen.push(next);
  }
  return chosen;
}

/** Geometry validation used for both fresh plans and imported JSON. */
export function riverHarborErrors(town: TownData): string[] {
  const docks = town.terrain?.docks.filter(d => d.waterbody === 'river') ?? [], errors: string[] = [];
  if (!docks.length) return town.request.riverHarbor ? ['Enabled river harbor has no safe dock'] : [];
  const river = town.river;
  if (!river?.surface) return ['River docks require an actual river surface'];
  const unit = river.bankWidth / 2.8, index = new Map(town.vertices.map(v => [v.id, v]));
  const bridges = river.bridges.flatMap(b => dockFootprints(b));
  const allDecks = town.terrain!.docks.flatMap(dockFootprints);
  const hulls = docks.map(d => berthFootprint(d.riverHarbor!.berth));
  const buildings = [...town.buildings, ...town.features].map(b => b.boundary.map(id => index.get(id)!));
  for (let i = 0; i < docks.length; i++) {
    const dock = docks[i], plan = dock.riverHarbor!, footprint = hulls[i], deck = dockFootprints(dock);
    const road = town.roads.find(r => r.id === dock.roadId);
    if (harborOverlap(plan.yard,river.surface) || town.terrain?.coast && harborOverlap(plan.yard,town.terrain.coast.water) || !inRing(plan.yard,dock.points[0])) errors.push(dock.id + ': cargo yard is wet or detached');
    if (!road || distanceToPath(dock.points[0], road.vertexIds.map(id => index.get(id)!)) > 1e-5) errors.push(dock.id + ': detached approach');
    if (dock.points.length !== 3 || !withinBank(deck[1], river) || !harborInside(footprint, river.surface)) errors.push(dock.id + ': platform or boat outside riverbank');
    if (town.terrain?.coast && [footprint, ...deck].some(p => harborOverlap(p, town.terrain!.coast!.water))) errors.push(dock.id + ': river berth enters sea');
    if ([footprint, ...deck].some(p => bridges.some(q => harborOverlap(p, q, .2 * unit)))) errors.push(dock.id + ': bridge collision');
    if (allDecks.some(p => harborOverlap(footprint, p, .1 * unit)) || hulls.some((p, j) => i !== j && harborOverlap(footprint, p, .1 * unit))) errors.push(dock.id + ': occupied berth');
    if (buildings.some(p => [...deck, plan.yard].some(q => harborOverlap(p, q)))) errors.push(dock.id + ': blocked cargo access');
    const nav = plan.navigation, route = dockFootprints({ points: nav.points, width: nav.width });
    if (nav.width < plan.berth.beam + .4 * unit || dist(nav.points[0], plan.berth.center) > 1e-5 || dist(nav.points.at(-1)!, nav.exit === 'start' ? river.centerline[0] : river.centerline.at(-1)!) > nav.width + 1e-5) errors.push(dock.id + ': invalid waterway connection');
    if (route.some(p => !harborInside(p, river.surface!) || [...bridges, ...allDecks, ...hulls.filter((_, j) => i !== j)].some(q => harborOverlap(p, q)))) errors.push(dock.id + ': blocked waterway');
    for (const wall of town.walls) for (let j = 0; j < wall.boundary.length; j++) if (wall.activeSegments[j]) {
      const a = index.get(wall.boundary[j])!, b = index.get(wall.boundary[(j + 1) % wall.boundary.length])!;
      if (dist(a, b) > 1e-6 && deck.some(p => harborOverlap(p, harborRectangle(a, b, .6 * unit)))) errors.push(dock.id + ': wall blocks approach');
    }
  }
  return errors;
}
