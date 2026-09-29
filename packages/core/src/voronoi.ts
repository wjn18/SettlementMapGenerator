// Port of com.watabou.geom.Voronoi, GPL-3.0.
import { GenerationContext, RetryableError, remove, sign } from './context.js';
import { Point } from './geometry.js';

class Triangle {
  readonly p1: Point; readonly p2: Point; readonly p3: Point;
  readonly c: Point; readonly r: number;
  constructor(p1: Point, p2: Point, p3: Point) {
    const s = (p2.x - p1.x) * (p2.y + p1.y) + (p3.x - p2.x) * (p3.y + p2.y) + (p1.x - p3.x) * (p1.y + p3.y);
    this.p1 = p1; this.p2 = s > 0 ? p2 : p3; this.p3 = s > 0 ? p3 : p2;
    const x1 = (p1.x + p2.x) / 2, y1 = (p1.y + p2.y) / 2, x2 = (p2.x + p3.x) / 2, y2 = (p2.y + p3.y) / 2;
    const dx1 = p1.y - p2.y, dy1 = p2.x - p1.x, dx2 = p2.y - p3.y, dy2 = p3.x - p2.x;
    const tg1 = dy1 / dx1, t2 = ((y1 - y2) - (x1 - x2) * tg1) / (dy2 - dx2 * tg1);
    this.c = new Point(x2 + dx2 * t2, y2 + dy2 * t2); this.r = Point.distance(this.c, p1);
  }
  hasEdge(a: Point, b: Point): boolean { return this.p1 === a && this.p2 === b || this.p2 === a && this.p3 === b || this.p3 === a && this.p1 === b; }
}
class Region {
  readonly vertices: Triangle[];
  constructor(readonly seed: Point, triangles: Triangle[]) {
    this.vertices = triangles.filter(t => t.p1 === seed || t.p2 === seed || t.p3 === seed);
    this.vertices.sort((v1, v2) => {
      const x1 = v1.c.x - seed.x, y1 = v1.c.y - seed.y, x2 = v2.c.x - seed.x, y2 = v2.c.y - seed.y;
      if (x1 >= 0 && x2 < 0) return 1; if (x2 >= 0 && x1 < 0) return -1;
      if (x1 === 0 && x2 === 0) return y2 > y1 ? 1 : -1;
      return sign(x2 * y1 - x1 * y2);
    });
  }
  center(): Point { const c = new Point(); for (const v of this.vertices) c.addEq(v.c); return c.scaleEq(1 / this.vertices.length); }
}
export class Voronoi {
  readonly frame: Point[]; readonly points: Point[]; readonly triangles: Triangle[];
  constructor(readonly context: GenerationContext, minx: number, miny: number, maxx: number, maxy: number) {
    const a = new Point(minx, miny), b = new Point(minx, maxy), c = new Point(maxx, miny), d = new Point(maxx, maxy);
    this.frame = [a, b, c, d]; this.points = [...this.frame]; this.triangles = [new Triangle(a, b, c), new Triangle(b, c, d)];
  }
  addPoint(p: Point): void {
    this.context.step();
    const split = this.triangles.filter(t => Point.distance(p, t.c) < t.r); if (!split.length) return;
    this.points.push(p); const a: Point[] = [], b: Point[] = [];
    for (const t1 of split) {
      let e1 = true, e2 = true, e3 = true;
      for (const t2 of split) if (t1 !== t2) {
        if (e1 && t2.hasEdge(t1.p2, t1.p1)) e1 = false;
        if (e2 && t2.hasEdge(t1.p3, t1.p2)) e2 = false;
        if (e3 && t2.hasEdge(t1.p1, t1.p3)) e3 = false;
        if (!(e1 || e2 || e3)) break;
      }
      if (e1) { a.push(t1.p1); b.push(t1.p2); }
      if (e2) { a.push(t1.p2); b.push(t1.p3); }
      if (e3) { a.push(t1.p3); b.push(t1.p1); }
    }
    let index = 0, count = 0;
    do {
      if (index < 0 || ++count > a.length) throw new RetryableError('Invalid Voronoi boundary');
      this.triangles.push(new Triangle(p, a[index], b[index])); index = a.indexOf(b[index]);
    } while (index !== 0);
    for (const t of split) remove(this.triangles, t);
  }
  partition(): Region[] {
    return this.points.map(p => new Region(p, this.triangles)).filter(r => r.vertices.every(t => !this.frame.includes(t.p1) && !this.frame.includes(t.p2) && !this.frame.includes(t.p3)));
  }
  static build(context: GenerationContext, points: Point[]): Voronoi {
    let minx = 1e10, miny = 1e10, maxx = -1e9, maxy = -1e9;
    for (const p of points) { minx = Math.min(minx, p.x); miny = Math.min(miny, p.y); maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y); }
    const dx = (maxx - minx) * 0.5, dy = (maxy - miny) * 0.5;
    const v = new Voronoi(context, minx - dx / 2, miny - dy / 2, maxx + dx / 2, maxy + dy / 2);
    for (const p of points) v.addPoint(p); return v;
  }
  static relax(v: Voronoi, toRelax: Point[]): Voronoi {
    const regions = v.partition(), points = [...v.points]; for (const p of v.frame) remove(points, p);
    for (const r of regions) if (toRelax.includes(r.seed)) { remove(points, r.seed); points.push(r.center()); }
    return Voronoi.build(v.context, points);
  }
}
