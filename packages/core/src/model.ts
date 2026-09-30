// Port of building/Model, Patch and CurtainWall, GPL-3.0.
import { GenerationContext, RetryableError, minimum, remove, sign } from './context.js';
import { Point, Polygon, containsPolygon } from './geometry.js';
import { Voronoi } from './voronoi.js';
import { Topology } from './topology.js';
import { Ward, createWard, wardRegistry, wardSequence } from './wards.js';
import { polygonTouchesRiver } from './river.js';

export class Patch {
  withinCity = false; withinWalls = false; ward: Ward | null = null;
  constructor(readonly shape: Polygon) {}
}
export interface ResolvedFeatures { plaza: boolean; castle: boolean; walls: boolean }
export const stages = ['buildPatches', 'optimizeJunctions', 'buildWalls', 'buildStreets', 'createWards', 'buildGeometry'] as const;
export type Stage = typeof stages[number];

export class Model {
  plannedLayout = false;
  primaryEntrances = new Set<Point>();
  roadWidths = new Map<Polygon, number>();
  patches: Patch[] = []; inner: Patch[] = [];
  citadel: Patch | null = null; plaza: Patch | null = null; center = new Point();
  border: CurtainWall | null = null; wall: CurtainWall | null = null;
  gates: Point[] = []; arteries: Polygon[] = []; streets: Polygon[] = []; roads: Polygon[] = [];
  cityRadius = 0;
  constructor(readonly context: GenerationContext, readonly size: number, readonly features: ResolvedFeatures) {}
  streetWidth(a: Point, b: Point): number {
    let width = 0;
    for (const [path, value] of this.roadWidths) for (let i = 1; i < path.length; i++) if ((path[i - 1] === a && path[i] === b) || (path[i - 1] === b && path[i] === a)) width = Math.max(width, value);
    return width;
  }
  *build(): Generator<Stage> {
    // Preserve within-instance retry behavior for legacy stage equivalence.
    this.streets = []; this.roads = [];
    for (const stage of stages) { this.context.stage = stage; this[stage](); yield stage; }
  }
  buildPatches(): void {
    const r = this.context.random, sa = r.float() * 2 * Math.PI;
    const points = Array.from({ length: this.size * 8 }, (_, i) => { const a = sa + Math.sqrt(i) * 5, radius = i === 0 ? 0 : 10 + i * (2 + r.float()); return new Point(Math.cos(a) * radius, Math.sin(a) * radius); });
    let v = Voronoi.build(this.context, points);
    for (let i = 0; i < 3; i++) v = Voronoi.relax(v, [...v.points.slice(0, 3), v.points[this.size]]);
    v.points.sort((a, b) => sign(a.length - b.length));
    this.patches = []; this.inner = [];
    for (const region of v.partition()) {
      const count = this.patches.length, patch = new Patch(new Polygon(region.vertices.map(t => t.c))); this.patches.push(patch);
      if (count === 0) { this.center = minimum(patch.shape, p => p.length); if (this.features.plaza) this.plaza = patch; }
      else if (count === this.size && this.features.castle) { this.citadel = patch; patch.withinCity = true; }
      if (count < this.size) { patch.withinCity = true; patch.withinWalls = this.features.walls; this.inner.push(patch); }
    }
  }
  optimizeJunctions(): void {
    const clean: Patch[] = [];
    for (const w of this.citadel ? [...this.inner, this.citadel] : this.inner) {
      let i = 0;
      while (i < w.shape.length) {
        const a = w.shape[i], b = w.shape[(i + 1) % w.shape.length];
        if (a !== b && Point.distance(a, b) < 8) {
          for (const other of this.patchByVertex(b)) if (other !== w) { other.shape[other.shape.indexOf(b)] = a; clean.push(other); }
          a.addEq(b).scaleEq(0.5); remove(w.shape, b);
        } i++;
      }
    }
    for (const w of clean) for (let i = 0, n = w.shape.length; i < n; i++) {
      const v = w.shape[i]; let index: number; while ((index = w.shape.indexOf(v, i + 1)) !== -1) w.shape.splice(index, 1);
    }
  }
  buildWalls(): void {
    this.border = new CurtainWall(this.features.walls, this, this.inner, this.citadel ? [...this.citadel.shape] : []);
    if (this.features.walls) { this.wall = this.border; this.wall.buildTowers(); }
    const radius = this.border.getRadius(); this.patches = this.patches.filter(p => p.shape.distance(this.center) < radius * 3);
    this.gates = this.border.gates;
    if (this.citadel) {
      const castle = createWard('Castle', this, this.citadel); castle.wall!.buildTowers(); this.citadel.ward = castle;
      if (this.citadel.shape.compactness < 0.75) throw new RetryableError('Bad citadel shape!');
      this.gates = this.gates.concat(castle.wall!.gates);
    }
  }
  buildStreets(): void {
    const topology = new Topology(this);
    for (const gate of this.gates) {
      const end = this.plaza ? minimum(this.plaza.shape, p => Point.distance(p, gate)) : this.center;
      const street = topology.buildPath(gate, end, topology.outer);
      if (!street) throw new RetryableError('Unable to build a street!');
      this.streets.push(street);
      if (this.border!.gates.includes(gate)) {
        const dir = gate.norm(1000), start = minimum([...topology.node2pt.values()], p => Point.distance(p, dir));
        const road = topology.buildPath(start, gate, topology.inner); if (road) this.roads.push(road);
      }
    }
    const segments: { start: Point; end: Point }[] = [];
    for (const street of [...this.streets, ...this.roads]) street.forSegment((a, b) => {
      if (this.plaza?.shape.includes(a) && this.plaza.shape.includes(b)) return;
      if (!segments.some(s => s.start === a && s.end === b)) segments.push({ start: a, end: b });
    });
    this.arteries = [];
    while (segments.length) {
      const s = segments.pop()!; let attached = false;
      for (const a of this.arteries) {
        if (a[0] === s.end) { a.unshift(s.start); attached = true; break; }
        else if (a[a.length - 1] === s.start) { a.push(s.end); attached = true; break; }
      }
      if (!attached) this.arteries.push(new Polygon([s.start, s.end]));
    }
    for (const a of this.arteries) { const smooth = a.smoothVertexEq(3); for (let i = 1; i < a.length - 1; i++) a[i].set(smooth[i]); }
  }
  createWards(): void {
    const random = this.context.random, unassigned = [...this.inner];
    if (this.plaza) { this.plaza.ward = createWard('Market', this, this.plaza); remove(unassigned, this.plaza); }
    for (const gate of this.border!.gates) for (const p of this.patchByVertex(gate)) {
      if (p.withinCity && p.ward === null && random.bool(this.wall === null ? 0.2 : 0.5)) { p.ward = createWard('GateWard', this, p); remove(unassigned, p); }
    }
    const sequence = [...wardSequence];
    for (let i = 0; i < Math.trunc(sequence.length / 10); i++) { const index = random.int(0, sequence.length - 1); [sequence[index], sequence[index + 1]] = [sequence[index + 1], sequence[index]]; }
    while (unassigned.length) {
      this.context.step();
      const type = sequence.shift() ?? 'Slum', rate = wardRegistry[type].rate;
      let best: Patch;
      if (rate) best = minimum(unassigned, p => p.ward === null ? rate(this, p) : Infinity);
      else { do { this.context.step(); best = unassigned[random.int(0, unassigned.length)]; } while (best.ward !== null); }
      best.ward = createWard(type, this, best); remove(unassigned, best);
    }
    if (this.wall) for (const gate of this.wall.gates) if (!random.bool(1 / (this.size - 5))) {
      for (const p of this.patchByVertex(gate)) if (p.ward === null) { p.withinCity = true; p.ward = createWard('GateWard', this, p); }
    }
    this.cityRadius = 0;
    for (const p of this.patches) {
      if (p.withinCity) for (const v of p.shape) this.cityRadius = Math.max(this.cityRadius, v.length);
      else if (p.ward === null) p.ward = createWard(random.bool(0.2) && p.shape.compactness >= 0.7 ? 'Farm' : 'Ward', this, p);
    }
  }
  buildGeometry(): void {
    for (const p of this.patches) {
      this.context.step();
      if (this.plannedLayout && p.shape.square < 8) continue;
      p.ward!.createGeometry();
      if (this.plannedLayout) {
        const minX = Math.min(...p.shape.map(v => v.x)), maxX = Math.max(...p.shape.map(v => v.x));
        const minY = Math.min(...p.shape.map(v => v.y)), maxY = Math.max(...p.shape.map(v => v.y));
        const nearby = [...this.roadWidths].filter(([path, width]) => Math.max(...path.map(v => v.x)) + width / 2 >= minX && Math.min(...path.map(v => v.x)) - width / 2 <= maxX && Math.max(...path.map(v => v.y)) + width / 2 >= minY && Math.min(...path.map(v => v.y)) - width / 2 <= maxY);
        // Reserve the entire road corridor, including the round caps of T
        // junctions and bridge landings that an edge-only inset cannot express.
        p.ward!.geometry = p.ward!.geometry.filter(shape => shape.square > 0.05 && containsPolygon(p.shape, shape) && !nearby.some(([path, width]) => polygonTouchesRiver(shape, { centerline: path, width, bankWidth: 0.05 })));
      }
    }
  }
  patchByVertex(v: Point): Patch[] { return this.patches.filter(p => p.shape.includes(v)); }
  getNeighbour(patch: Patch, v: Point): Patch | null { const next = patch.shape.next(v); return this.patches.find(p => p.shape.findEdge(next, v) !== -1) ?? null; }
  getNeighbours(patch: Patch): Patch[] { return this.patches.filter(p => p !== patch && p.shape.borders(patch.shape)); }
  isEnclosed(p: Patch): boolean { return p.withinCity && (p.withinWalls || this.getNeighbours(p).every(n => n.withinCity)); }
  static findCircumference(patches: Patch[]): Polygon {
    if (patches.length <= 1) return new Polygon(patches[0]?.shape);
    const a: Point[] = [], b: Point[] = [];
    for (const p of patches) p.shape.forEdge((v0, v1) => { if (!patches.some(w => w.shape.findEdge(v1, v0) !== -1)) { a.push(v0); b.push(v1); } });
    const result = new Polygon(); let i = 0;
    do {
      if (i < 0 || result.length >= a.length) throw new RetryableError('Invalid city circumference');
      result.push(a[i]); i = a.indexOf(b[i]);
    } while (i !== 0); return result;
  }
}
export class CurtainWall {
  readonly shape: Polygon; readonly segments: boolean[]; readonly gates: Point[] = []; towers: Point[] = [];
  constructor(real: boolean, model: Model, readonly patches: Patch[], reserved: Point[]) {
    this.shape = patches.length === 1 ? patches[0].shape : Model.findCircumference(patches);
    if (patches.length !== 1 && real && !model.plannedLayout) {
      const factor = Math.min(1, 40 / patches.length), smooth = this.shape.map(v => reserved.includes(v) ? v : this.shape.smoothVertex(v, factor));
      this.shape.forEach((v, i) => v.set(smooth[i]));
    }
    this.segments = this.shape.map(() => true);
    const entrances = this.shape.filter(v => !reserved.includes(v) && (patches.length === 1 || (model.plannedLayout ? model.primaryEntrances.has(v) : patches.filter(p => p.shape.includes(v)).length > 1)));
    if (!entrances.length) throw new RetryableError('Bad walled area shape!');
    do {
      const index = model.context.random.int(0, entrances.length), gate = entrances[index]; this.gates.push(gate);
      if (real && !model.plannedLayout) {
        const outer = model.patchByVertex(gate).filter(p => !patches.includes(p));
        if (outer.length === 1 && outer[0].shape.length > 3) {
          const p = outer[0], w = this.shape.next(gate).subtract(this.shape.prev(gate)), out = new Point(w.y, -w.x);
          const farthest = minimum(p.shape, v => { if (this.shape.includes(v) || reserved.includes(v)) return Infinity; const dir = v.subtract(gate); return -dir.dot(out) / dir.length; });
          model.patches.splice(model.patches.indexOf(p), 1, ...p.shape.split(gate, farthest).map(s => new Patch(s)));
        }
      }
      if (model.plannedLayout && patches.length > 1) entrances.splice(index, 1);
      else if (index === 0) { entrances.splice(0, 2); entrances.pop(); }
      else if (index === entrances.length - 1) { entrances.splice(index - 1, 2); entrances.shift(); }
      else entrances.splice(index - 1, 3);
    } while (model.plannedLayout && patches.length > 1 ? entrances.length > 0 : entrances.length >= 3);
    if (real && !model.plannedLayout) for (const gate of this.gates) gate.set(this.shape.smoothVertex(gate));
  }
  buildTowers(): void { this.towers = this.shape.filter((v, i) => !this.gates.includes(v) && (this.segments[(i + this.shape.length - 1) % this.shape.length] || this.segments[i])); }
  getRadius(): number { let r = 0; for (const v of this.shape) r = Math.max(r, v.length); return r; }
  bordersBy(p: Patch, a: Point, b: Point): boolean { const i = this.patches.includes(p) ? this.shape.findEdge(a, b) : this.shape.findEdge(b, a); return i !== -1 && this.segments[i]; }
  borders(p: Patch): boolean { return this.shape.some((v, i) => this.segments[i] && (this.patches.includes(p) ? p.shape.findEdge(v, this.shape.next(v)) : p.shape.findEdge(this.shape.next(v), v)) !== -1); }
}
