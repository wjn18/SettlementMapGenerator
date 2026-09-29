// Port of building/Cutter.hx, GPL-3.0.
import { minimum } from './context.js';
import { Point, Polygon, interpolate } from './geometry.js';
export function bisect(poly: Polygon, v: Point, ratio: number, angle: number, gap: number): Polygon[] {
  const next = poly.next(v), p = interpolate(v, next, ratio), d = next.subtract(v), c = Math.cos(angle), s = Math.sin(angle);
  const vx = d.x * c - d.y * s, vy = d.y * c + d.x * s;
  return poly.cut(p, new Point(p.x - vy, p.y + vx), gap);
}
export function radial(poly: Polygon, semi = false, gap = 0.6): Polygon[] {
  const centroid = poly.centroid, center = semi ? minimum(poly, v => Point.distance(v, centroid)) : centroid;
  const result: Polygon[] = [];
  poly.forEdge((a, b) => {
    if (semi && (a === center || b === center)) return;
    let p = new Polygon([center, a, b]);
    if (gap > 0) p = p.shrink([!semi || poly.findEdge(center, a) === -1 ? gap / 2 : 0, 0, !semi || poly.findEdge(b, center) === -1 ? gap / 2 : 0]);
    result.push(p);
  }); return result;
}
export function ring(poly: Polygon, thickness: number): Polygon[] {
  const slices: { p1: Point; p2: Point; length: number }[] = [];
  poly.forEdge((a, b) => { const v = b.subtract(a), n = v.rotate90().norm(thickness); slices.push({ p1: a.add(n), p2: b.add(n), length: v.length }); });
  slices.sort((a, b) => a.length - b.length);
  const result: Polygon[] = []; let p = poly;
  for (const s of slices) { const halves = p.cut(s.p1, s.p2); p = halves[0]; if (halves.length === 2) result.push(halves[1]); }
  return result;
}
