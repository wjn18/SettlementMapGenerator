import { Point, Polygon, containsPolygon } from './geometry.js';
import { Patch, type Model } from './model.js';
import { defensiveEnvelope } from './fortifications.js';
import { inRing, partitionLand, mixPoint, splitSegment } from './terrain-geometry.js';
import type { Point2 } from './types.js';

/** Freeze the defensive perimeter before land use, streets and buildings.
 * Reuse the rural tessellation inside it; split at the wall instead of turning
 * entire straddling farms into city land. Small remnants become public green. */
export function planWalledInfill(model: Model, waterCuts: Point2[][]): void {
  if (!model.wall) return;
  const envelope = defensiveEnvelope([...model.wall.shape, ...(model.citadel?.shape ?? [])]);
  model.cityEnvelope = envelope;
  model.wallCorridors = envelope.flatMap((a, i) => {
    const parts = splitSegment(a, envelope[(i + 1) % envelope.length], waterCuts);
    return parts.slice(1).flatMap((b, j) => waterCuts.some(c => inRing(c, mixPoint(parts[j], b, 0.5))) ? [] : [new Polygon([parts[j], b])]);
  });
  const subdivide = (shape: Polygon): Polygon[] => {
    model.context.step();
    if (shape.square <= 1000) return [shape];
    const edges = shape.map((a, i) => ({ a, b: shape[(i + 1) % shape.length] })).sort((x, y) => Point.distance(y.a, y.b) - Point.distance(x.a, x.b));
    for (const { a, b } of edges) {
      const at = mixPoint(a, b, 0.42 + model.context.random.float() * 0.16);
      const parts = shape.cut(at, at.add(b.subtract(a).rotate90()));
      if (parts.length !== 2 || parts.some(p => p.square < 90 || p.square < shape.square * 0.18 || p.compactness < 0.2)) continue;
      return parts.flatMap(subdivide);
    }
    return [shape];
  };
  const buildable = envelope.shrinkEq(2.8);
  model.patches = model.patches.flatMap(patch => {
    model.context.step();
    if (patch.withinCity) {
      patch.withinWalls = containsPolygon(envelope, patch.shape); return [patch];
    }
    const { inside, outside } = partitionLand(patch.shape, envelope);
    if (!inside.length) return [patch];
    return [
      ...outside.map(shape => new Patch(shape)),
      ...inside.flatMap(subdivide).map(shape => {
        const p = new Patch(shape); p.withinCity = true; p.withinWalls = true;
        const usable = partitionLand(shape, buildable).inside.reduce((sum, part) => sum + part.square, 0);
        p.infill = usable < 100 || shape.compactness < 0.28 || shape.square / shape.perimeter < 3 ? 'green' : 'housing';
        return p;
      }),
    ];
  });
}
