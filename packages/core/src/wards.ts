// Port of com.watabou.towngenerator.wards, GPL-3.0.
import { GenerationContext, minimum } from './context.js';
import { Point, Polygon, distanceToLine, interpolate } from './geometry.js';
import { bisect, radial, ring } from './cutter.js';
import { CurtainWall } from './model.js';
import type { Model, Patch } from './model.js';

type CommonParameters = [minSquare: number, gridChaos: number, sizeChaos: number, emptyProbability: number];
interface WardStrategy {
  parameters?: (context: GenerationContext) => CommonParameters;
  rate?: (model: Model, patch: Patch) => number;
  geometry?: (ward: Ward) => Polygon[];
}
export type WardType = 'Ward' | 'CraftsmenWard' | 'GateWard' | 'MerchantWard' | 'AdministrationWard' | 'PatriciateWard' | 'Slum' | 'MilitaryWard' | 'Cathedral' | 'Castle' | 'Market' | 'Park' | 'Farm';
const centerDistance = (m: Model, p: Patch): number => p.shape.distance(m.plaza ? m.plaza.shape.center : m.center);
const longest = (p: Polygon): Point => minimum(p, v => -p.vector(v).length);

export function createAlleys(context: GenerationContext, p: Polygon, minSq: number, gridChaos: number, sizeChaos: number, emptyProb = 0.04, split = true, depth = 0): Polygon[] {
  context.step(depth); const r = context.random, v = longest(p), spread = 0.8 * gridChaos;
  const ratio = (1 - spread) / 2 + r.float() * spread;
  const angleSpread = Math.PI / 6 * gridChaos * (p.square < minSq * 4 ? 0 : 1), b = (r.float() - 0.5) * angleSpread;
  const buildings: Polygon[] = [];
  for (const half of bisect(p, v, ratio, b, split ? 0.6 : 0)) {
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
    for (const half of p.cut(p1, p1.add(c))) {
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
    if (type === 'Castle') this.wall = new CurtainWall(true, model, [patch], patch.shape.filter(v => model.patchByVertex(v).some(p => !p.withinCity)));
  }
  createGeometry(): void {
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
      if (m.wall?.bordersBy(p, a, b)) inset.push(1);
      else {
        let onStreet = inner && !!m.plaza && m.plaza.shape.findEdge(b, a) !== -1;
        if (!onStreet) onStreet = m.arteries.some(s => s.includes(a) && s.includes(b));
        inset.push((onStreet ? 2 : inner ? 1 : 0.6) / 2);
      }
    }); return p.shape.isConvex() ? p.shape.shrink(inset) : p.shape.buffer(inset);
  }
  private filterOutskirts(): void {
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
    this.geometry = this.geometry.filter(building => {
      let minDist = 1;
      for (const e of edges) for (const v of building) { const d = distanceToLine(e.x, e.y, e.dx, e.dy, v.x, v.y) / e.d; if (d < minDist) minDist = d; }
      const weights = p.shape.interpolate(building.center); let population = 0;
      for (let j = 0; j < weights.length; j++) population += density[j] * weights[j];
      minDist /= population; return m.context.random.fuzzy(1) > minDist;
    });
  }
}
export function createWard(type: WardType, model: Model, patch: Patch): Ward { return new Ward(type, model, patch); }

/** Explicit strategies avoid Haxe reflection and inherited static scoring differences. */
export const wardRegistry: Readonly<Record<WardType, WardStrategy>> = Object.freeze({
  Ward: {},
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
  Castle: { geometry: w => { const p = w.patch.shape.shrinkEq(4); return createOrthoBuilding(w.model.context, p, Math.sqrt(p.square) * 4, 0.6); } },
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
