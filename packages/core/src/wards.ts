// Port of com.watabou.towngenerator.wards, GPL-3.0.
import { GenerationContext, RetryableError, minimum } from './context.js';
import { Point, Polygon, distanceToLine, interpolate } from './geometry.js';
import { bisect, radial, ring } from './cutter.js';
import { CurtainWall } from './model.js';
import { createCastleFootprint } from './castle.js';
import { partitionLand } from './terrain-geometry.js';
import type { Model, Patch } from './model.js';

type CommonParameters = [minSquare: number, gridChaos: number, sizeChaos: number, emptyProbability: number];
interface WardStrategy {
  parameters?: (context: GenerationContext) => CommonParameters;
  rate?: (model: Model, patch: Patch) => number;
  geometry?: (ward: Ward) => Polygon[];
}
export type WardType = 'Ward' | 'CraftsmenWard' | 'GateWard' | 'MerchantWard' | 'AdministrationWard' | 'PatriciateWard' | 'Slum' | 'MilitaryWard' | 'Cathedral' | 'Castle' | 'Market' | 'Park' | 'Farm' | 'Harbor';
const centerDistance = (m: Model, p: Patch): number => p.shape.distance(m.plaza ? m.plaza.shape.center : m.center);
const longest = (p: Polygon): Point => minimum(p, v => -p.vector(v).length);

export function createAlleys(context: GenerationContext, p: Polygon, minSq: number, gridChaos: number, sizeChaos: number, emptyProb = 0.04, split = true, depth = 0): Polygon[] {
  context.step(depth); const r = context.random, v = longest(p), spread = 0.8 * gridChaos;
  const ratio = (1 - spread) / 2 + r.float() * spread;
  const angleSpread = Math.PI / 6 * gridChaos * (p.square < minSq * 4 ? 0 : 1), b = (r.float() - 0.5) * angleSpread;
  const buildings: Polygon[] = [];
  const halves = bisect(p, v, ratio, b, split ? 0.6 : 0);
  if (halves.length < 2 || halves.some(half => half.square >= p.square * (1 - 1e-9))) throw new RetryableError('Building subdivision made no progress');
  for (const half of halves) {
    if (half.square < minSq * Math.pow(2, 4 * sizeChaos * (r.float() - 0.5))) {
      if (!r.bool(emptyProb)) { context.geometry(); buildings.push(half); }
    } else buildings.push(...createAlleys(context, half, minSq, gridChaos, sizeChaos, emptyProb, half.square > minSq / (r.float() * r.float()), depth + 1));
  }
  return buildings;
}
export function createOrthoBuilding(context: GenerationContext, poly: Polygon, minSq: number, fill: number): Polygon[] {
  if (poly.square < minSq) { context.geometry(); return [poly]; }
  const c1 = poly.vector(longest(poly)), c2 = c1.rotate90(), r = context.random;
  function slice(p: Polygon, depth = 0): Polygon[] {
    context.step(depth); const v0 = longest(p), v1 = p.next(v0), v = v1.subtract(v0);
    const ratio = 0.4 + r.float() * 0.2, p1 = interpolate(v0, v1, ratio), c = Math.abs(v.dot(c1)) < Math.abs(v.dot(c2)) ? c1 : c2;
    const buildings: Polygon[] = [];
    const halves = p.cut(p1, p1.add(c));
    if (halves.length < 2 || halves.some(half => half.square >= p.square * (1 - 1e-9))) throw new RetryableError('Orthogonal subdivision made no progress');
    for (const half of halves) {
      if (half.square < minSq * Math.pow(2, r.normal() * 2 - 1)) { if (r.bool(fill)) { context.geometry(); buildings.push(half); } }
      else buildings.push(...slice(half, depth + 1));
    }
    return buildings;
  }
  for (;;) { context.step(); const result = slice(poly); if (result.length) return result; }
}
export class Ward {
  geometry: Polygon[] = [];
  wall: CurtainWall | null = null;
  featureKind: 'grove' | 'statue' | 'fountain' | null = null;
  readonly parameters: CommonParameters | undefined;
  constructor(readonly type: WardType, readonly model: Model, readonly patch: Patch) {
    this.parameters = wardRegistry[type].parameters?.(model.context);
    if (model.plannedLayout && this.parameters) this.parameters = [Math.max(22, this.parameters[0]), Math.min(0.3, this.parameters[1]), Math.min(0.4, this.parameters[2]), Math.max(0.1, this.parameters[3])];
    if (type === 'Castle') this.wall = new CurtainWall(true, model, [patch], patch.shape.filter(v => model.patchByVertex(v).some(p => !p.withinCity)));
  }
  createGeometry(): void {
    // Wall-side remnants remain usable public land even when they cannot hold
    // a building or a grove after the defensive corridor is reserved.
    if (this.model.cityEnvelope && this.getCityBlock().square < 8) { this.geometry = []; return; }
    if (this.parameters) {
      this.geometry = createAlleys(this.model.context, this.getCityBlock(), ...this.parameters);
      if (!this.model.isEnclosed(this.patch)) this.filterOutskirts();
    } else {
      this.geometry = wardRegistry[this.type].geometry?.(this) ?? [];
      if (this.type === 'Market' || this.type === 'Park') this.model.context.geometry(this.geometry.length);
    }
  }
  getCityBlock(): Polygon {
    const m = this.model, p = this.patch, inner = m.wall === null || p.withinWalls, inset: number[] = [];
    p.shape.forEdge((a, b) => {
      if (m.plannedLayout) { inset.push(Math.max(0.7, m.streetWidth(a, b) / 2 + 0.3)); return; }
      if (m.wall?.bordersBy(p, a, b)) inset.push(1);
      else {
        let onStreet = inner && !!m.plaza && m.plaza.shape.findEdge(b, a) !== -1;
        if (!onStreet) onStreet = m.arteries.some(s => s.includes(a) && s.includes(b));
        inset.push((onStreet ? 2 : inner ? 1 : 0.6) / 2);
      }
    });
    if (m.plannedLayout) {
      // T junctions belong to the road graph, not to the shape used by the
      // polygon insetter. Collinear corners otherwise create zero-width loops.
      const keep = p.shape.map((v, i) => ({ v, i })).filter(({ v, i }) => {
        const before = v.subtract(p.shape[(i + p.shape.length - 1) % p.shape.length]), after = p.shape[(i + 1) % p.shape.length].subtract(v);
        return Math.abs(before.x * after.y - before.y * after.x) > 1e-7 * before.length * after.length;
      });
      const shape = new Polygon(keep.map(k => k.v));
      const distances = keep.map((k, i) => {
        const end = keep[(i + 1) % keep.length].i; let value = 0, j = k.i;
        do { value = Math.max(value, inset[j]); j = (j + 1) % inset.length; } while (j !== end);
        return value;
      });
      const block = shape.isConvex() ? shape.shrink(distances) : shape.buffer(distances);
      if (m.cityEnvelope && p.withinWalls) {
        const candidates = partitionLand(block, m.cityEnvelope.shrinkEq(2.8)).inside;
        return candidates.sort((a, b) => b.square - a.square)[0] ?? new Polygon();
      }
      return block;
    }
    return p.shape.isConvex() ? p.shape.shrink(inset) : p.shape.buffer(inset);
  }
  private filterOutskirts(): void {
    if (this.model.plannedLayout) {
      const m = this.model, p = this.patch;
      const frontages = p.shape.map((a, i) => ({ a, b: p.shape[(i + 1) % p.shape.length] })).filter(e => m.streetWidth(e.a, e.b) > 0);
      if (!frontages.length) { this.geometry = []; return; }
      const distance = (v: Point) => Math.min(...frontages.map(({ a, b }) => {
        const d = b.subtract(a), t = Math.max(0, Math.min(1, v.subtract(a).dot(d) / d.dot(d)));
        return Point.distance(v, a.add(d.scale(t)));
      }));
      const depth = Math.max(9, Math.sqrt(p.shape.square) * 0.42);
      this.geometry = this.geometry.filter(b => distance(b.center) < depth * (0.75 + m.context.random.float() * 0.65));
      return;
    }
    const m = this.model, p = this.patch, edges: { x: number; y: number; dx: number; dy: number; d: number }[] = [];
    const addEdge = (a: Point, b: Point, factor: number): void => {
      const dx = b.x - a.x, dy = b.y - a.y, distances = new Map<Point, number>();
      const farthest = minimum(p.shape, v => { const d = (v !== a && v !== b ? distanceToLine(a.x, a.y, dx, dy, v.x, v.y) : 0) * factor; distances.set(v, d); return -d; });
      edges.push({ x: a.x, y: a.y, dx, dy, d: distances.get(farthest)! });
    };
    p.shape.forEdge((a, b) => {
      if (m.arteries.some(s => s.includes(a) && s.includes(b))) addEdge(a, b, 1);
      else { const n = m.getNeighbour(p, a); if (n?.withinCity) addEdge(a, b, m.isEnclosed(n) ? 1 : 0.4); }
    });
    const density = p.shape.map(v => m.gates.includes(v) ? 1 : m.patchByVertex(v).every(n => n.withinCity) ? 2 * m.context.random.float() : 0);
    // Waterfront topology puts a street on every block edge. Such blocks are
    // fully developed even when they border countryside and isEnclosed is false.
    const surroundedByStreets = p.shape.every((a, i) => {
      const b = p.shape[(i + 1) % p.shape.length];
      return m.arteries.some(street => street.some((v, j) => j > 0 &&
        ((street[j - 1] === a && v === b) || (street[j - 1] === b && v === a))));
    });
    this.geometry = this.geometry.filter(building => {
      let minDist = 1;
      for (const e of edges) for (const v of building) { const d = distanceToLine(e.x, e.y, e.dx, e.dy, v.x, v.y) / e.d; if (d < minDist) minDist = d; }
      const weights = p.shape.interpolate(building.center); let population = 0;
      for (let j = 0; j < weights.length; j++) population += density[j] * weights[j];
      // Still consume the original draws so later wards and retries keep their seed layout.
      minDist /= population;
      const occupied = m.context.random.fuzzy(1) > minDist;
      return surroundedByStreets || occupied;
    });
  }
}
export function createWard(type: WardType, model: Model, patch: Patch): Ward { return new Ward(type, model, patch); }

/** Explicit strategies avoid Haxe reflection and inherited static scoring differences. */
export const wardRegistry: Readonly<Record<WardType, WardStrategy>> = Object.freeze({
  Ward: {},
  Harbor: { parameters: () => [28, 0.12, 0.35, 0.06] },
  CraftsmenWard: { parameters: c => { const r = c.random; return [10 + 80 * r.float() * r.float(), 0.5 + r.float() * 0.2, 0.6, 0.04]; } },
  GateWard: { parameters: c => { const r = c.random; return [10 + 50 * r.float() * r.float(), 0.5 + r.float() * 0.3, 0.7, 0.04]; } },
  MerchantWard: { parameters: c => { const r = c.random; return [50 + 60 * r.float() * r.float(), 0.5 + r.float() * 0.3, 0.7, 0.15]; }, rate: centerDistance },
  AdministrationWard: { parameters: c => { const r = c.random; return [80 + 30 * r.float() * r.float(), 0.1 + r.float() * 0.3, 0.3, 0.04]; }, rate: (m, p) => m.plaza && p.shape.borders(m.plaza.shape) ? 0 : centerDistance(m, p) },
  PatriciateWard: { parameters: c => { const r = c.random; return [80 + 30 * r.float() * r.float(), 0.5 + r.float() * 0.3, 0.8, 0.2]; }, rate: (m, p) => {
    let score = 0; for (const n of m.patches) if (n.ward && n.shape.borders(p.shape)) { if (n.ward.type === 'Park') score--; else if (n.ward.type === 'Slum') score++; } return score;
  } },
  Slum: { parameters: c => { const r = c.random; return [10 + 30 * r.float() * r.float(), 0.6 + r.float() * 0.4, 0.8, 0.03]; }, rate: (m, p) => -centerDistance(m, p) },
  MilitaryWard: {
    rate: (m, p) => m.citadel && m.citadel.shape.borders(p.shape) ? 0 : m.wall?.borders(p) ? 1 : m.citadel === null && m.wall === null ? 0 : Infinity,
    geometry: w => { const p = w.getCityBlock(), c = w.model.context, r = c.random; return createAlleys(c, p, Math.sqrt(p.square) * (1 + r.float()), 0.1 + r.float() * 0.3, 0.3, 0.25); },
  },
  Cathedral: {
    rate: (m, p) => m.plaza && p.shape.borders(m.plaza.shape) ? -1 / p.shape.square : centerDistance(m, p) * p.shape.square,
    geometry: w => {
      const c = w.model.context;
      if (!c.random.bool(0.4)) return createOrthoBuilding(c, w.getCityBlock(), 50, 0.8);
      const result = ring(w.getCityBlock(), 2 + c.random.float() * 4); c.geometry(result.length); return result;
    },
  },
  Castle: { geometry: w => {
    const p = w.patch.shape.shrinkEq(4), context = w.model.context;
    // At the new city sizes, cap subdivision density so a large keep still
    // merges into one regular footprint instead of many disconnected cells.
    const minSquare = Math.max(Math.sqrt(p.square) * 4, w.model.plannedLayout ? p.square / 6 : w.model.size > 40 ? p.square / 8 : 0);
    return [createCastleFootprint(context, p, () => createOrthoBuilding(context, p, minSquare, 0.6))];
  } },
  Market: {
    rate: (m, p) => m.inner.some(n => n.ward?.type === 'Market' && n.shape.borders(p.shape)) ? Infinity : m.plaza ? p.shape.square / m.plaza.shape.square : p.shape.distance(m.center),
    geometry: w => {
      const r = w.model.context.random, shape = w.patch.shape, statue = r.bool(0.6), offset = statue || r.bool(0.3);
      let a = shape[0], b = shape[1]; if (statue || offset) { a = longest(shape); b = shape.next(a); }
      let object: Polygon;
      if (statue) { object = Polygon.rect(1 + r.float(), 1 + r.float()); object.rotate(Math.atan2(b.y - a.y, b.x - a.x)); }
      else object = Polygon.regular(16, 1 + r.float());
      object.offset(offset ? interpolate(shape.centroid, interpolate(a, b), 0.2 + r.float() * 0.4) : shape.centroid);
      w.featureKind = statue ? 'statue' : 'fountain'; return [object];
    },
  },
  Park: { geometry: w => { const p = w.getCityBlock(); w.featureKind = 'grove'; return radial(p, p.compactness < 0.7); } },
  Farm: { geometry: w => {
    const r = w.model.context.random, shape = w.patch.shape, housing = Polygon.rect(4, 4);
    const pos = interpolate(shape[r.int(0, shape.length)], shape.centroid, 0.3 + r.float() * 0.4);
    housing.rotate(r.float() * Math.PI); housing.offset(pos); return createOrthoBuilding(w.model.context, housing, 8, 0.5);
  } },
} satisfies Record<WardType, WardStrategy>);

export const wardSequence: readonly WardType[] = Object.freeze([
  'CraftsmenWard', 'CraftsmenWard', 'MerchantWard', 'CraftsmenWard', 'CraftsmenWard', 'Cathedral',
  'CraftsmenWard', 'CraftsmenWard', 'CraftsmenWard', 'CraftsmenWard', 'CraftsmenWard',
  'CraftsmenWard', 'CraftsmenWard', 'CraftsmenWard', 'AdministrationWard', 'CraftsmenWard',
  'Slum', 'CraftsmenWard', 'Slum', 'PatriciateWard', 'Market',
  'Slum', 'CraftsmenWard', 'CraftsmenWard', 'CraftsmenWard', 'Slum',
  'CraftsmenWard', 'CraftsmenWard', 'CraftsmenWard', 'MilitaryWard', 'Slum',
  'CraftsmenWard', 'Park', 'PatriciateWard', 'Market', 'MerchantWard',
]);
