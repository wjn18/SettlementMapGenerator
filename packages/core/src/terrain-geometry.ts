import { Point, Polygon } from './geometry.js';
import { RetryableError } from './context.js';
import type { Point2 } from './types.js';

const EPS = 1e-7;
export const pointKey = (p: Point2): string => `${Math.round(p.x / EPS)},${Math.round(p.y / EPS)}`;
export const mixPoint = (a: Point2, b: Point2, t: number): Point => new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
export function inRing(ring: readonly Point2[], p: Point2): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function intersection(a: Point2, b: Point2, c: Point2, d: Point2): [number, number] | null {
  const ux = b.x - a.x, uy = b.y - a.y, vx = d.x - c.x, vy = d.y - c.y;
  const determinant = ux * vy - uy * vx;
  if (Math.abs(determinant) < 1e-10) return null;
  const dx = c.x - a.x, dy = c.y - a.y;
  const t = (dx * vy - dy * vx) / determinant, u = (dx * uy - dy * ux) / determinant;
  return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? [Math.max(0, Math.min(1, t)), Math.max(0, Math.min(1, u))] : null;
}
export function splitSegment(a: Point2, b: Point2, rings: readonly Point2[][]): Point[] {
  const cuts = [0, 1];
  for (const ring of rings) for (let i = 0; i < ring.length; i++) {
    const hit = intersection(a, b, ring[i], ring[(i + 1) % ring.length]);
    if (hit) cuts.push(hit[0]);
  }
  return cuts.sort((x, y) => x - y).filter((v, i, all) => !i || v - all[i - 1] > 1e-9).map(t => mixPoint(a, b, t));
}

/** Boundary arrangement for simple, positive rings. Terrain cuts extend beyond
 * the settlement, so subtraction cannot produce an enclosed polygon hole. */
export function subtractRing(subject: Polygon, clip: Point2[]): Polygon[] {
  const edges: { a: Point; b: Point; used: boolean }[] = [];
  const add = (a: Point, b: Point) => { if (Point.distance(a, b) > EPS) edges.push({ a, b, used: false }); };
  subject.forEdge((a, b) => {
    const points = splitSegment(a, b, [clip]);
    for (let i = 1; i < points.length; i++) if (!inRing(clip, mixPoint(points[i - 1], points[i], 0.5))) add(points[i - 1], points[i]);
  });
  for (let j = 0; j < clip.length; j++) {
    const points = splitSegment(clip[j], clip[(j + 1) % clip.length], [subject]);
    for (let i = 1; i < points.length; i++) if (inRing(subject, mixPoint(points[i - 1], points[i], 0.5))) add(points[i], points[i - 1]);
  }
  const starts = new Map<string, typeof edges>();
  for (const edge of edges) { const key = pointKey(edge.a); if (!starts.has(key)) starts.set(key, []); starts.get(key)!.push(edge); }
  const result: Polygon[] = [];
  for (const first of edges) {
    if (first.used) continue;
    const ring = new Polygon(); let edge: typeof first | undefined = first;
    while (edge && !edge.used) {
      edge.used = true; ring.push(edge.a);
      if (pointKey(edge.b) === pointKey(first.a)) break;
      edge = starts.get(pointKey(edge.b))?.find(next => !next.used);
    }
    if (!edge || pointKey(edge.b) !== pointKey(first.a)) throw new RetryableError('Open land boundary after water clipping');
    if (ring.square < -0.01) throw new RetryableError('Enclosed terrain holes are unsupported');
    if (ring.length >= 3 && ring.square > 0.01) result.push(ring);
  }
  return result;
}
export function positiveRing(points: Point2[]): Point[] {
  const ring = new Polygon(points.map(p => new Point(p.x, p.y)));
  return ring.square < 0 ? ring.reverse() : ring;
}

/** Partition land against a positive convex boundary using half-plane cuts.
 * Retain disconnected pieces of concave land.
 * The half-plane cutters extend beyond the subject, so no polygon holes arise. */
export function partitionLand(subject: Polygon, boundary: Polygon): { inside: Polygon[]; outside: Polygon[] } {
  let inside = [subject]; const outside: Polygon[] = [];
  boundary.forEdge((a, b) => {
    const direction = b.subtract(a).norm(), normal = direction.rotate90();
    const next: Polygon[] = [];
    for (const ring of inside) {
      const distances = ring.map(p => p.subtract(a).dot(normal));
      if (Math.min(...distances) >= -1e-7) { next.push(ring); continue; }
      if (Math.max(...distances) <= 1e-7) { outside.push(ring); continue; }
      const extent = Math.max(...ring.map(p => Point.distance(a, p))) * 4 + 1;
      const left = a.subtract(direction.scale(extent)), right = a.add(direction.scale(extent));
      const offset = normal.scale(extent);
      next.push(...subtractRing(ring, [left, left.subtract(offset), right.subtract(offset), right]));
      outside.push(...subtractRing(ring, [left, right, right.add(offset), left.add(offset)]));
    }
    inside = next;
  });
  return { inside, outside };
}
