import { GenerationContext, RetryableError } from './context.js';
import { Point, Polygon, containsPolygon, cross } from './geometry.js';

const EPS = 1e-7;
const MAX_ATTEMPTS = 64;
const samePoint = (a: Point, b: Point): boolean => Point.distance(a, b) <= EPS;
const onSegment = (p: Point, a: Point, b: Point): boolean => {
  const v = b.subtract(a), w = p.subtract(a);
  return Math.abs(cross(v.x, v.y, w.x, w.y)) <= EPS * v.length && w.dot(v) >= -EPS && w.dot(v) <= v.dot(v) + EPS;
};

/** Union of non-overlapping subdivision cells. Split T-junctions before
 * cancelling shared edges; separate components and courtyard holes are rejected. */
export function mergeCastleParts(parts: readonly Polygon[], context?: GenerationContext): Polygon | null {
  if (!parts.length || parts.some(p => p.length < 3 || !Number.isFinite(p.square) || p.square <= EPS)) return null;
  const vertices: Point[] = [];
  const cells = parts.map(p => p.map(v => {
    let i = vertices.findIndex(q => samePoint(v, q));
    if (i < 0) { i = vertices.length; vertices.push(v); }
    return i;
  }));
  const edges = new Map<string, [number, number]>();
  for (const cell of cells) for (let i = 0; i < cell.length; i++) {
    context?.step();
    const a = vertices[cell[i]], b = vertices[cell[(i + 1) % cell.length]], v = b.subtract(a);
    if (v.length <= EPS) return null;
    const cuts = vertices.map((p, id) => ({ p, id })).filter(({ p }) => onSegment(p, a, b))
      .sort((p, q) => p.p.subtract(a).dot(v) - q.p.subtract(a).dot(v));
    for (let j = 1; j < cuts.length; j++) {
      const start = cuts[j - 1].id, end = cuts[j].id, key = `${start}/${end}`, reverse = `${end}/${start}`;
      if (edges.has(key)) return null;
      if (!edges.delete(reverse)) edges.set(key, [start, end]);
    }
  }
  if (edges.size < 3) return null;
  const next = new Map<number, number>(), incoming = new Set<number>();
  for (const [a, b] of edges.values()) {
    // Point contacts are not a connected building footprint.
    if (next.has(a) || incoming.has(b)) return null;
    next.set(a, b); incoming.add(b);
  }
  const start = edges.values().next().value![0], visited = new Set<number>(), outline = new Polygon();
  let id: number | undefined = start;
  while (id !== undefined && !visited.has(id)) {
    visited.add(id); outline.push(vertices[id]); id = next.get(id);
  }
  if (id !== start || visited.size !== edges.size) return null;
  // Remove collinear division endpoints, retaining only actual exterior corners.
  let changed = true;
  while (changed && outline.length > 3) {
    changed = false;
    for (let i = 0; i < outline.length; i++) {
      if (onSegment(outline[i], outline[(i + outline.length - 1) % outline.length], outline[(i + 1) % outline.length])) {
        outline.splice(i, 1); changed = true; break;
      }
    }
  }
  const area = parts.reduce((sum, p) => sum + p.square, 0);
  return Math.abs(outline.square - area) <= EPS * Math.max(1, area) ? outline : null;
}

/** Keep readable, substantial silhouettes: no self-intersections, needle tips,
 * tiny edges, excessive corners, long thin wings, or deeply indented outlines. */
export function isRegularCastleFootprint(p: Polygon, block: Polygon): boolean {
  if (p.length < 3 || p.length > 12 || p.some(v => !Number.isFinite(v.x) || !Number.isFinite(v.y))) return false;
  if (!Number.isFinite(p.square) || p.square < Math.max(EPS, block.square * 0.3) || p.compactness < 0.55 || !containsPolygon(block, p)) return false;
  const minEdge = Math.sqrt(p.square) * 0.08;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], before = p[(i + p.length - 1) % p.length].subtract(a), after = b.subtract(a);
    if (after.length < minEdge || before.dot(after) / (before.length * after.length) > Math.cos(40 * Math.PI / 180)) return false;
    for (let j = i + 2; j < p.length; j++) {
      if (i === 0 && j === p.length - 1) continue;
      const c = p[j], d = p[(j + 1) % p.length], ab = b.subtract(a), cd = d.subtract(c);
      const side = (v: Point, origin: Point, q: Point): number => cross(v.x, v.y, q.x - origin.x, q.y - origin.y);
      if (onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d) ||
        (side(ab, a, c) * side(ab, a, d) < 0 && side(cd, c, a) * side(cd, c, b) < 0)) return false;
    }
  }
  // Use the minimum-area oriented box so rotating the map does not affect quality.
  let boxArea = Infinity, aspect = Infinity;
  p.forEdge((a, b) => {
    const axis = b.subtract(a).norm(), normal = axis.rotate90();
    const x = p.map(v => v.subtract(a).dot(axis)), y = p.map(v => v.subtract(a).dot(normal));
    const width = Math.max(...x) - Math.min(...x), height = Math.max(...y) - Math.min(...y);
    if (width * height < boxArea) { boxArea = width * height; aspect = Math.max(width, height) / Math.min(width, height); }
  });
  return aspect <= 2.5 && p.square / boxArea >= 0.6;
}

export function createCastleFootprint(context: GenerationContext, block: Polygon, createParts: () => Polygon[]): Polygon {
  let nextDistrictState: number | undefined;
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      context.step();
      const parts = createParts();
      nextDistrictState ??= context.random.state;
      const outline = mergeCastleParts(parts, context);
      if (outline && isRegularCastleFootprint(outline, block)) return outline;
    }
    // Let the normal, bounded town retry loop select a new site if this one fails.
    throw new RetryableError('Unable to generate a regular connected castle');
  } finally {
    // Extra castle candidates use a local continuation of the seeded stream.
    // They still count toward resource budgets, but do not reroll other districts.
    if (nextDistrictState !== undefined) context.random.state = nextDistrictState;
  }
}
