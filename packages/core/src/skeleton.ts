import { GenerationContext, RetryableError, minimum } from './context.js';
import { Point, Polygon } from './geometry.js';
import { Model, Patch } from './model.js';
import { createWard } from './wards.js';
import { inRing, pointKey } from './terrain-geometry.js';
import type { ResolvedFeatures } from './model.js';
import type { WardType } from './wards.js';

/** A through route and staggered branches reserve the transport network first.
 * Development spreads from that network; the rural planning envelope is never
 * used as a city boundary. Walls enclose the older part of the resulting growth. */
export class SkeletonModel extends Model {
  override plannedLayout = true;
  readonly guides: { path: Polygon; width: number }[] = [];
  readonly planningRadius: number;
  private growthCenters: Point[] = [];
  constructor(context: GenerationContext, size: number, features: ResolvedFeatures) {
    super(context, size, features); this.planningRadius = Math.sqrt(size * 900 / Math.PI);
  }

  override buildPatches(): void {
    const r = this.context.random, radius = this.planningRadius;
    const rotation = r.float() * Math.PI * 2, phase = r.float() * Math.PI * 2;
    const turn = (r.float() - 0.5) * 0.3;
    const world = (x: number, y: number) => new Point(x * Math.cos(rotation) - y * Math.sin(rotation), x * Math.sin(rotation) + y * Math.cos(rotation));
    const spineY = (x: number) => radius * 0.18 * (Math.sin(x / radius * 1.5 + phase) - Math.sin(phase)) + x * turn;
    const extent = radius * 1.85;
    const branchCount = this.size < 16 ? 2 : 3;
    const sides = [-1, 1].map(side => {
      const positions = Array.from({ length: branchCount }, (_, i) => radius * (-0.95 + i * 1.7 / (branchCount - 1) + side * 0.14 + (r.float() - 0.5) * 0.22));
      return { side, positions: [-extent, ...positions, extent] };
    });
    // Each side joins at different points: there is no radial hub or perimeter road.
    const positions = [...new Set(sides.flatMap(s => s.positions))].sort((a, b) => a - b);
    const spine = positions.map(x => world(x, spineY(x)));
    this.guides.length = 0; this.guides.push({ path: new Polygon(spine), width: 3.8 });
    this.growthCenters = [world(-radius * 0.22, spineY(-radius * 0.22)), world(radius * 0.5, spineY(radius * 0.5))];
    this.patches = []; this.inner = []; this.plaza = null; this.citadel = null;
    for (const { side, positions: xs } of sides) {
      const branches = xs.map((x, i) => {
        const at = spine[positions.indexOf(x)];
        const shift = i === 0 || i === xs.length - 1 ? 0 : radius * (r.float() - 0.5) * 0.55;
        const bend = world(x + shift, spineY(x) + side * radius * (0.7 + r.float() * 0.15));
        const end = world(x + shift * 1.4, side * extent);
        const path = new Polygon([at, bend, end]);
        if (i > 0 && i < xs.length - 1) this.guides.push({ path, width: i === 1 ? 3.8 : 2.6 });
        if (i === 1) this.growthCenters.push(at.add(bend.subtract(at).scale(0.55)));
        return path;
      });
      for (let i = 1; i < xs.length; i++) {
        const a = positions.indexOf(xs[i - 1]), b = positions.indexOf(xs[i]);
        const ring = new Polygon([...spine.slice(a, b + 1), ...branches[i].slice(1), ...branches[i - 1].slice(1).reverse()]);
        if (side < 0) ring.reverse();
        const patch = new Patch(ring); this.patches.push(patch);
      }
    }
    this.center = spine.reduce((a, b) => a.length < b.length ? a : b);
    this.conformBoundaries();
  }

  override optimizeJunctions(): void { /* Preserve the pre-existing transport routes. */ }

  /** Local streets inherit frontage directions. A connected growth frontier then
   * chooses developed blocks, leaving variable-depth ribbons and rural recesses. */
  subdivideDistricts(waterCuts: import('./types.js').Point2[][] = []): void {
    const radius = this.planningRadius, r = this.context.random;
    const pending = [...this.patches], parcels: Patch[] = [];
    while (pending.length) {
      this.context.step();
      const patch = pending.pop()!, distance = patch.shape.center.length / radius;
      const targetArea = 520 + 100 * distance * distance + (distance > 1.55 ? 1500 : 0);
      if (patch.shape.square < targetArea * 1.65) { parcels.push(patch); continue; }
      const edges = patch.shape.map((a, i) => ({ a, b: patch.shape[(i + 1) % patch.shape.length] })).sort((a, b) => Point.distance(b.a, b.b) - Point.distance(a.a, a.b));
      let divided = false;
      for (const edge of edges) {
        const ratio = 0.38 + r.float() * 0.24, at = edge.a.add(edge.b.subtract(edge.a).scale(ratio));
        const normal = edge.b.subtract(edge.a).rotate90(), skew = (r.float() - 0.5) * 0.22;
        const direction = normal.add(edge.b.subtract(edge.a).scale(skew));
        const parts = patch.shape.cut(at, at.add(direction));
        if (parts.length !== 2 || parts.some(p => p.square < 90 || p.square < patch.shape.square * 0.16 || p.compactness < 0.26)) continue;
        pending.push(...parts.map(shape => new Patch(shape))); divided = true; break;
      }
      if (!divided) parcels.push(patch);
    }
    this.patches = parcels; this.conformBoundaries();
    const key = (a: Point, b: Point) => [pointKey(a), pointKey(b)].sort().join('/');
    const edges = new Map<Patch, string[]>(), owners = new Map<string, Patch[]>();
    for (const p of parcels) {
      const keys = p.shape.map((a, i) => key(a, p.shape[(i + 1) % p.shape.length])); edges.set(p, keys);
      for (const k of keys) { if (!owners.has(k)) owners.set(k, []); owners.get(k)!.push(p); }
    }
    const distanceToGuides = (p: Point) => Math.min(...this.guides.flatMap(g => g.path.slice(1).map((b, i) => {
      const a = g.path[i], v = b.subtract(a), t = Math.max(0, Math.min(1, p.subtract(a).dot(v) / v.dot(v)));
      return Point.distance(p, a.add(v.scale(t)));
    })));
    const dry = (p: Patch) => !waterCuts.some(cut => inRing(cut, p.shape.center));
    const scores = new Map(parcels.map(p => {
      const c = p.shape.center, centerDistance = Math.min(...this.growthCenters.map((h, i) => Point.distance(c, h) * (i < 2 ? 1 : 1.25)));
      return [p, centerDistance / radius * 0.85 + distanceToGuides(c) / radius * 0.65 + r.float() * 0.16 + (dry(p) ? 0 : 0.18)] as const;
    }));
    const seed = minimum(parcels.filter(dry), p => p.shape.center.length);
    const grown = new Set<Patch>(), frontier = new Set<Patch>(), usedVertices = new Set<Point>();
    const add = (p: Patch) => {
      grown.add(p); frontier.delete(p); p.withinCity = true;
      for (const v of p.shape) usedVertices.add(v);
      for (const k of edges.get(p)!) for (const n of owners.get(k)!) if (!grown.has(n)) frontier.add(n);
    };
    const canAttach = (p: Patch) => {
      const shared = edges.get(p)!.map(k => owners.get(k)!.some(n => grown.has(n)));
      if (shared.every(Boolean)) return false;
      // One continuous attachment arc avoids holes and point-touching lobes.
      if (shared.filter((v, i) => v && !shared[(i + shared.length - 1) % shared.length]).length !== 1) return false;
      return p.shape.every((v, i) => !usedVertices.has(v) || shared[i] || shared[(i + shared.length - 1) % shared.length]);
    };
    add(seed);
    const coreCount = this.features.walls && this.size >= 12 ? Math.floor(this.size * 0.82) : this.size;
    while (grown.size < this.size) {
      this.context.step();
      const priority = (p: Patch) => scores.get(p)! - edges.get(p)!.filter(k => owners.get(k)!.some(n => grown.has(n))).length * 0.025;
      const options = [...frontier].sort((a, b) => priority(a) - priority(b));
      const next = options.find(canAttach);
      if (!next) throw new RetryableError('Urban growth has no connected frontage');
      add(next);
      if (grown.size === coreCount) this.inner = [...grown];
    }
    if (!this.inner.length) this.inner = [...grown];
    for (const p of this.inner) p.withinWalls = this.features.walls;
    // A modest market belongs to a road junction, without forcing every route
    // to terminate there. Reserve it before any water clipping or buildings.
    if (this.features.plaza) this.plaza = minimum([...grown].filter(dry), p => p.shape.center.length + p.shape.square * 0.025);
    this.center = this.plaza?.shape[0] ?? seed.shape[0];
    this.citadel = null;
    if (this.features.castle) {
      const candidates = parcels.filter(p => !grown.has(p) && dry(p) && p.shape.compactness >= 0.75 && p.shape.square > 220 && edges.get(p)!.some(k => owners.get(k)!.some(n => this.inner.includes(n))));
      if (!candidates.length) throw new RetryableError('No compact castle site on the developed edge');
      this.citadel = minimum(candidates, p => p.shape.center.length); this.citadel.withinCity = true;
      const shape = this.citadel.shape;
      for (let i = 0; i < shape.length; i++) if (this.getNeighbour(this.citadel, shape[i])?.withinCity) {
        shape.splice(i + 1, 0, shape[i].add(shape[(i + 1) % shape.length]).scale(0.5)); break;
      }
      this.conformBoundaries();
    }
    const border = Model.findCircumference(this.inner);
    this.primaryEntrances = new Set(border.filter(p => this.guides.some(g => g.path.slice(1).some((b, i) => {
      const a = g.path[i], v = b.subtract(a), t = p.subtract(a).dot(v) / v.dot(v);
      return t >= 0 && t <= 1 && Point.distance(p, a.add(v.scale(t))) < 1e-5;
    }))));
    if (!this.primaryEntrances.size) throw new RetryableError('No transport route reaches the developed boundary');
  }

  /** Water can remove whole blocks. Recover the requested land-block count
   * without expanding into water or changing the reserved transport routes. */
  fitLandDistricts(): void {
    const target = this.size + Number(!!this.citadel);
    while (this.patches.filter(p => p.withinCity).length < target) {
      this.context.step();
      const candidates = this.patches.filter(p => p.withinCity && p !== this.plaza && p !== this.citadel).sort((a, b) => b.shape.square - a.shape.square);
      let split = false;
      for (const patch of candidates) {
        const edges = patch.shape.map((a, i) => ({ a, b: patch.shape[(i + 1) % patch.shape.length] })).sort((a, b) => Point.distance(b.a, b.b) - Point.distance(a.a, a.b));
        for (const edge of edges) {
          const at = edge.a.add(edge.b.subtract(edge.a).scale(0.42 + this.context.random.float() * 0.16));
          const parts = patch.shape.cut(at, at.add(edge.b.subtract(edge.a).rotate90()));
          if (parts.length !== 2 || parts.some(p => p.square < 35 || p.square < patch.shape.square * 0.18 || p.compactness < 0.25)) continue;
          const children = parts.map(shape => { const p = new Patch(shape); p.withinCity = true; p.withinWalls = patch.withinWalls; return p; });
          this.patches.splice(this.patches.indexOf(patch), 1, ...children);
          const inner = this.inner.indexOf(patch); if (inner >= 0) this.inner.splice(inner, 1, ...children);
          split = true; break;
        }
        if (split) break;
      }
      if (!split) throw new RetryableError('Not enough buildable land for requested district count');
    }
    this.conformBoundaries();
  }

  /** Share every road junction, including T junctions, by object identity. */
  private conformBoundaries(): void {
    const points = new Map<string, Point>();
    const rings = [...this.patches.map(p => p.shape), ...(this.border ? [this.border.shape] : []), ...(this.wall && this.wall !== this.border ? [this.wall.shape] : [])];
    for (const ring of rings) for (let i = 0; i < ring.length; i++) {
      const key = pointKey(ring[i]); if (!points.has(key)) points.set(key, ring[i]); ring[i] = points.get(key)!;
    }
    const all = [...points.values()];
    for (const ring of rings) {
      const next: Point[] = [];
      ring.forEdge((a, b) => {
        const vector = b.subtract(a), length2 = vector.dot(vector);
        const cuts = all.filter(p => { const t = p.subtract(a).dot(vector) / length2; return t >= 0 && t < 1 - 1e-8 && Math.abs(vector.x * (p.y - a.y) - vector.y * (p.x - a.x)) < 1e-6; });
        cuts.sort((p, q) => p.subtract(a).dot(vector) - q.subtract(a).dot(vector)); next.push(...cuts);
      });
      ring.splice(0, ring.length, ...next);
    }
    for (const wall of [this.border, this.wall, this.citadel?.ward?.wall]) if (wall) {
      wall.segments.splice(0, wall.segments.length, ...wall.shape.map(() => true));
      wall.buildTowers();
    }
  }

  guideWidth(a: Point, b: Point): number {
    const on = (p: Point, x: Point, y: Point) => {
      const v = y.subtract(x), t = p.subtract(x).dot(v) / v.dot(v);
      return t >= -1e-6 && t <= 1 + 1e-6 && Math.abs(v.x * (p.y - x.y) - v.y * (p.x - x.x)) / v.length < 1e-4;
    };
    let width = 1.4;
    for (const guide of this.guides) for (let i = 1; i < guide.path.length; i++) if (on(a, guide.path[i - 1], guide.path[i]) && on(b, guide.path[i - 1], guide.path[i])) width = Math.max(width, guide.width);
    return width;
  }

  override createWards(): void {
    const r = this.context.random;
    const available = this.patches.filter(p => p.withinCity && p !== this.citadel && p !== this.plaza).sort((a, b) => a.shape.center.length - b.shape.center.length);
    if (this.plaza) this.plaza.ward = createWard('Market', this, this.plaza);
    const mix: WardType[] = ['CraftsmenWard', 'CraftsmenWard', 'MerchantWard', 'CraftsmenWard', 'Slum', 'CraftsmenWard', 'PatriciateWard', 'GateWard', 'CraftsmenWard', 'CraftsmenWard', 'MerchantWard', 'Park'];
    available.forEach((p, i) => {
      let type: WardType = mix[(i + r.int(0, 3)) % mix.length];
      if (i === 0 && this.size >= 12) type = 'Cathedral';
      else if (i === 1 && this.size >= 24) type = 'AdministrationWard';
      else if (this.citadel && p.shape.borders(this.citadel.shape)) type = 'MilitaryWard';
      else if (this.gates.some(gate => p.shape.includes(gate))) type = 'GateWard';
      p.ward = createWard(type, this, p);
    });
    this.cityRadius = Math.max(...this.patches.filter(p => p.withinCity).flatMap(p => p.shape.map(v => v.length)));
    for (const p of this.patches) if (!p.withinCity) p.ward = createWard(r.bool(0.14) && p.shape.center.length < this.cityRadius * 1.35 ? 'Farm' : 'Ward', this, p);
  }
}

/** Plan coordinates are four metres apart. Scale every length together so the
 * exported geometry, road widths, river, grid and population share metre units.
 * This is a generation design scale, not a historical population calibration. */
export function scalePlannedTown(town: import('./types.js').TownData): void {
  const factor = 4, seen = new Set<object>();
  const scale = (p: { x: number; y: number }) => { if (!seen.has(p)) { seen.add(p); p.x *= factor; p.y *= factor; } };
  town.vertices.forEach(scale); scale(town.center);
  for (const road of town.roads) road.width *= factor;
  if (town.river) {
    const river = town.river; river.width *= factor; river.bankWidth *= factor;
    river.centerline.forEach(scale); river.surface?.forEach(scale);
    for (const bridge of river.bridges) { bridge.points.forEach(scale); bridge.width *= factor; }
  }
  if (town.terrain) {
    const coast = town.terrain.coast;
    if (coast) { coast.shoreline.forEach(scale); coast.water.forEach(scale); }
    for (const dock of town.terrain.docks) { dock.points.forEach(scale); dock.width *= factor; }
  }
  for (const key of ['minX', 'minY', 'maxX', 'maxY'] as const) town.bounds[key] *= factor;
}
