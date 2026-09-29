// Port of com.watabou.geom and PointExtender, GPL-3.0.
import { ResourceLimitError, remove } from './context.js';

export class Point {
  constructor(public x = 0, public y = 0) {}
  get length(): number { return Math.sqrt(this.x * this.x + this.y * this.y); }
  set(p: Point): void { this.x = p.x; this.y = p.y; }
  add(p: Point): Point { return new Point(this.x + p.x, this.y + p.y); }
  subtract(p: Point): Point { return new Point(this.x - p.x, this.y - p.y); }
  addEq(p: Point): this { this.x += p.x; this.y += p.y; return this; }
  scale(s: number): Point { return new Point(this.x * s, this.y * s); }
  scaleEq(s: number): this { this.x *= s; this.y *= s; return this; }
  norm(size = 1): Point {
    const p = new Point(this.x, this.y), length = p.length;
    if (length !== 0) p.scaleEq(size / length);
    return p;
  }
  rotate90(): Point { return new Point(-this.y, this.x); }
  dot(p: Point): number { return this.x * p.x + this.y * p.y; }
  static distance(a: Point, b: Point): number { return a.subtract(b).length; }
}
export const cross = (x1: number, y1: number, x2: number, y2: number): number => x1 * y2 - y1 * x2;
export function interpolate(a: Point, b: Point, ratio = 0.5): Point { return a.add(b.subtract(a).scale(ratio)); }
export function intersect(x1: number, y1: number, dx1: number, dy1: number, x2: number, y2: number, dx2: number, dy2: number): Point | null {
  const d = dx1 * dy2 - dy1 * dx2;
  if (d === 0) return null;
  const t2 = (dy1 * (x2 - x1) - dx1 * (y2 - y1)) / d;
  return new Point(dx1 !== 0 ? (x2 - x1 + dx2 * t2) / dx1 : (y2 - y1 + dy2 * t2) / dy1, t2);
}
export function distanceToLine(x1: number, y1: number, dx: number, dy: number, x0: number, y0: number): number {
  return (dx * y0 - dy * x0 + (y1 + dy) * x1 - (x1 + dx) * y1) / Math.sqrt(dx * dx + dy * dy);
}

/** Internal topology uses object identity; public topology uses IDs. */
export class Polygon extends Array<Point> {
  static get [Symbol.species](): ArrayConstructor { return Array; }
  constructor(points: readonly Point[] = []) { super(); this.push(...points); }
  get square(): number {
    if (!this.length) return 0;
    let v1 = this[this.length - 1], v2 = this[0], s = v1.x * v2.y - v2.x * v1.y;
    for (let i = 1; i < this.length; i++) { v1 = v2; v2 = this[i]; s += v1.x * v2.y - v2.x * v1.y; }
    return s * 0.5;
  }
  get perimeter(): number { let s = 0; this.forEdge((a, b) => { s += Point.distance(a, b); }); return s; }
  get compactness(): number { const p = this.perimeter; return 4 * Math.PI * this.square / (p * p); }
  get center(): Point { const p = new Point(); for (const v of this) p.addEq(v); return p.scaleEq(1 / this.length); }
  get centroid(): Point {
    let x = 0, y = 0, a = 0;
    this.forEdge((v0, v1) => { const f = cross(v0.x, v0.y, v1.x, v1.y); a += f; x += (v0.x + v1.x) * f; y += (v0.y + v1.y) * f; });
    const s = 1 / (3 * a); return new Point(s * x, s * y);
  }
  forEdge(f: (a: Point, b: Point, i: number) => void): void { for (let i = 0, n = this.length; i < n; i++) f(this[i], this[(i + 1) % n], i); }
  forSegment(f: (a: Point, b: Point) => void): void { for (let i = 0; i < this.length - 1; i++) f(this[i], this[i + 1]); }
  offset(p: Point): void { for (const v of this) v.addEq(p); }
  rotate(a: number): void {
    const c = Math.cos(a), s = Math.sin(a);
    for (const v of this) { const x = v.x * c - v.y * s, y = v.y * c + v.x * s; v.x = x; v.y = y; }
  }
  next(v: Point): Point { return this[(this.indexOf(v) + 1) % this.length]; }
  prev(v: Point): Point { return this[(this.indexOf(v) + this.length - 1) % this.length]; }
  vector(v: Point): Point { return this.next(v).subtract(v); }
  vectori(i: number): Point { return this[(i + 1) % this.length].subtract(this[i]); }
  isConvex(): boolean { return this.every(v => { const a = v.subtract(this.prev(v)), b = this.next(v).subtract(v); return cross(a.x, a.y, b.x, b.y) > 0; }); }
  smoothVertex(v: Point, f = 1): Point { const a = this.prev(v), b = this.next(v); return new Point(a.x + v.x * f + b.x, a.y + v.y * f + b.y).scale(1 / (2 + f)); }
  smoothVertexEq(f = 1): Polygon { return new Polygon(this.map((v, i) => { const a = this[(i + this.length - 1) % this.length], b = this[(i + 1) % this.length]; return new Point((a.x + v.x * f + b.x) / (2 + f), (a.y + v.y * f + b.y) / (2 + f)); })); }
  // Compatibility: upstream accidentally returns the first vertex distance.
  distance(p: Point): number { return Point.distance(this[0], p); }
  findEdge(a: Point, b: Point): number { const i = this.indexOf(a); return i !== -1 && this[(i + 1) % this.length] === b ? i : -1; }
  borders(p: Polygon): boolean { return this.some(v => p.includes(v) && (this.next(v) === p.next(v) || this.next(v) === p.prev(v))); }
  split(a: Point, b: Point): Polygon[] {
    let i = this.indexOf(a), j = this.indexOf(b); if (i > j) [i, j] = [j, i];
    return [new Polygon(this.slice(i, j + 1)), new Polygon(this.slice(j).concat(this.slice(0, i + 1)))];
  }
  cut(a: Point, b: Point, gap = 0): Polygon[] {
    const dx = b.x - a.x, dy = b.y - a.y;
    let edge1 = 0, edge2 = 0, ratio1 = 0, ratio2 = 0, count = 0;
    this.forEdge((v0, v1, i) => {
      const t = intersect(a.x, a.y, dx, dy, v0.x, v0.y, v1.x - v0.x, v1.y - v0.y);
      if (t !== null && t.y >= 0 && t.y <= 1) {
        if (count === 0) { edge1 = i; ratio1 = t.x; } else if (count === 1) { edge2 = i; ratio2 = t.x; } count++;
      }
    });
    if (count !== 2) return [new Polygon(this)];
    const p1 = interpolate(a, b, ratio1), p2 = interpolate(a, b, ratio2);
    let h1 = new Polygon([p1, ...this.slice(edge1 + 1, edge2 + 1), p2]);
    let h2 = new Polygon([p2, ...this.slice(edge2 + 1), ...this.slice(0, edge1 + 1), p1]);
    if (gap > 0) { h1 = h1.peel(p2, gap / 2); h2 = h2.peel(p1, gap / 2); }
    const v = this.vectori(edge1); return cross(dx, dy, v.x, v.y) > 0 ? [h1, h2] : [h2, h1];
  }
  peel(a: Point, d: number): Polygon { const b = this.next(a), n = b.subtract(a).rotate90().norm(d); return this.cut(a.add(n), b.add(n))[0]; }
  shrink(distances: number[]): Polygon {
    let p: Polygon = new Polygon(this);
    this.forEdge((a, b, i) => { if (distances[i] > 0) { const n = b.subtract(a).rotate90().norm(distances[i]); p = p.cut(a.add(n), b.add(n))[0]; } }); return p;
  }
  shrinkEq(d: number): Polygon { return this.shrink(this.map(() => d)); }
  buffer(distances: number[]): Polygon {
    const q = new Polygon();
    this.forEdge((a, b, i) => { const d = distances[i]; if (d === 0) q.push(a, b); else { const n = b.subtract(a).rotate90().norm(d); q.push(a.add(n), b.add(n)); } });
    let wasCut: boolean, lastEdge = 0, budget = 100_000;
    do {
      wasCut = false;
      const n = q.length;
      for (let i = lastEdge; i < n - 2; i++) {
        lastEdge = i; const a = q[i], b = q[i + 1];
        for (let j = i + 2; j < (i > 0 ? n : n - 1); j++) {
          if (--budget <= 0) throw new ResourceLimitError('Polygon buffer budget exceeded');
          const c = q[j], d = q[(j + 1) % n];
          const t = intersect(a.x, a.y, b.x - a.x, b.y - a.y, c.x, c.y, d.x - c.x, d.y - c.y);
          if (t && t.x > 0.000001 && t.x < 0.999999 && t.y > 0.000001 && t.y < 0.999999) {
            const p = interpolate(a, b, t.x); q.splice(j + 1, 0, p); q.splice(i + 1, 0, p); wasCut = true; break;
          }
        }
        if (wasCut) break;
      }
    } while (wasCut);
    const regular = q.map((_, i) => i); let best = new Polygon(), bestArea = -Infinity;
    while (regular.length) {
      const indices: number[] = [], start = regular[0]; let i = start;
      do {
        if (--budget <= 0) throw new ResourceLimitError('Polygon traversal budget exceeded');
        indices.push(i); remove(regular, i); const next = (i + 1) % q.length, v = q[next];
        let next1 = q.indexOf(v); if (next1 === next) next1 = q.lastIndexOf(v); i = next1 === -1 ? next : next1;
      } while (i !== start);
      const p = new Polygon(indices.map(i => q[i])); if (p.square > bestArea) { best = p; bestArea = p.square; }
    }
    return best;
  }
  interpolate(p: Point): number[] { let sum = 0; const d = this.map(v => { const n = 1 / Point.distance(v, p); sum += n; return n; }); return d.map(n => n / sum); }
  static rect(w = 1, h = 1): Polygon { return new Polygon([new Point(-w / 2, -h / 2), new Point(w / 2, -h / 2), new Point(w / 2, h / 2), new Point(-w / 2, h / 2)]); }
  static regular(n = 8, r = 1): Polygon { return new Polygon(Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2; return new Point(r * Math.cos(a), r * Math.sin(a)); })); }
}
