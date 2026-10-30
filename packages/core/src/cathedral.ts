import { GenerationContext } from './context.js';
import { Point, Polygon, containsPolygon } from './geometry.js';

export type CathedralRole = 'main_hall' | 'bell_tower' | 'annex';
export interface CathedralPart { role: CathedralRole; shape: Polygon }
export interface CathedralLayout { parts: CathedralPart[]; hallWidth: number }

/** Plan units (exported at 4 metres/unit). The parcel stays irregular; only the
 * architecture is rectangular. A 10m nave and 6m square tower are the minimum. */
const MIN_HALL_WIDTH = 2.5;
export function fitCathedral(block: Polygon, options: {
  context?: GenerationContext; frontage?: Point; frontages?: readonly (readonly Point[])[];
  accepts?: (shape: Polygon) => boolean;
} = {}): CathedralLayout | null {
  if (block.length < 3 || block.square < 30) return null;
  const target = Math.max(MIN_HALL_WIDTH, Math.min(7, Math.sqrt(block.square) * 0.23));
  const widths = [...new Set([target, target * 0.85, target * 0.7, target * 0.55, MIN_HALL_WIDTH]
    .filter(w => w >= MIN_HALL_WIDTH).sort((a, b) => b - a))];
  const parcelAngles: number[] = [];
  for (const edge of block.map((a, i) => block[(i + 1) % block.length].subtract(a)).sort((a, b) => b.length - a.length)) {
    if (edge.length < 1e-5) continue;
    const angle = ((Math.atan2(edge.y, edge.x) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    if (!parcelAngles.some(a => Math.min(Math.abs(a - angle), Math.PI / 2 - Math.abs(a - angle)) < 0.025)) parcelAngles.push(angle);
  }
  const angles = parcelAngles.slice(0, 6);
  // The long side of the tightest edge-aligned box describes the parcel,
  // independently of the entrance target. Ignore almost-square box noise.
  let enclosingArea = Infinity, parcelAxis: Point | null = null;
  for (const angle of parcelAngles) {
    const u = new Point(Math.cos(angle), Math.sin(angle)), v = u.rotate90();
    const us = block.map(p => p.dot(u)), vs = block.map(p => p.dot(v));
    const length = Math.max(...us) - Math.min(...us), width = Math.max(...vs) - Math.min(...vs);
    if (length * width < enclosingArea - 1e-8) {
      enclosingArea = length * width;
      parcelAxis = Math.max(length, width) / Math.min(length, width) >= 1.12 ? (length >= width ? u : v) : null;
    }
  }
  if (parcelAxis) {
    const axisAngle = ((Math.atan2(parcelAxis.y, parcelAxis.x) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    if (!angles.some(angle => Math.abs(angle - axisAngle) < 1e-8)) angles.push(axisAngle);
  }
  const frontages = options.frontages?.filter(path => path.length > 1) ?? [];
  const entranceDistance = (entry: Point): number => {
    if (!frontages.length) return Point.distance(entry, options.frontage ?? block.centroid);
    let closest = Infinity;
    for (const path of frontages) for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], vector = path[i].subtract(a), square = vector.dot(vector);
      const t = square ? Math.max(0, Math.min(1, entry.subtract(a).dot(vector) / square)) : 0;
      closest = Math.min(closest, Point.distance(entry, a.add(vector.scale(t))));
    }
    return closest;
  };
  // Prefer a full-sized church; try smaller regular plans before rejecting the
  // site. Never clip a nave or tower against a wedge-shaped parcel edge.
  for (const width of widths) {
    let best: CathedralLayout | null = null, bestScore = -Infinity, bestAlignment = -Infinity;
    for (const base of angles) for (const turn of [0, Math.PI / 2]) {
      const angle = base + turn, u = new Point(Math.cos(angle), Math.sin(angle)), v = u.rotate90();
      const alignment = parcelAxis ? Math.abs(u.dot(parcelAxis)) : 0;
      const us = block.map(p => p.dot(u)), vs = block.map(p => p.dot(v));
      const minU = Math.min(...us), maxU = Math.max(...us), minV = Math.min(...vs), maxV = Math.max(...vs);
      const length = width * 2.4, tower = width * 0.6;
      if (maxU - minU < length + tower || maxV - minV < width) continue;
      const candidates = [block.centroid];
      // Include the extrema of the feasible envelope, not just parcel vertices
      // or its centroid: triangular and concave lots often fit off-centre.
      for (let x = 0; x <= 8; x++) for (let y = 0; y <= 8; y++) {
        const a = minU + (length + tower) / 2 + (maxU - minU - length - tower) * x / 8;
        const b = minV + width / 2 + (maxV - minV - width) * y / 8;
        candidates.push(u.scale(a).add(v.scale(b)));
      }
      for (const center of candidates) for (const direction of [1, -1]) {
        options.context?.step();
        const along = u.scale(direction), across = v.scale(direction);
        const rectangle = (x0: number, y0: number, x1: number, y1: number) => new Polygon(
          [[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y]) => center.add(along.scale(x)).add(across.scale(y))));
        const hall = rectangle(-length / 2 + tower / 2, -width / 2, length / 2 + tower / 2, width / 2);
        const bell = rectangle(-length / 2 - tower / 2, -tower / 2, -length / 2 + tower / 2, tower / 2);
        const fits = (p: Polygon) => containsPolygon(block, p) && (options.accepts?.(p) ?? true);
        if (!fits(hall) || !fits(bell)) continue;
        const parts: CathedralPart[] = [{ role: 'main_hall', shape: hall }, { role: 'bell_tower', shape: bell }];
        // Short, broad orthogonal transepts; omit an arm when the site narrows.
        // Shared edges meet the nave, while the volumes never overlap.
        const x0 = length * 0.1 + tower / 2, x1 = x0 + width * 0.72;
        for (const side of [-1, 1]) {
          const arm = side < 0 ? rectangle(x0, -width * 1.1, x1, -width / 2)
            : rectangle(x0, width / 2, x1, width * 1.1);
          if (fits(arm)) parts.push({ role: 'annex', shape: arm });
        }
        const entry = center.add(along.scale(-(length + tower) / 2));
        const score = (parts.length - 2) * width * 2 - entranceDistance(entry)
          - Point.distance(center, block.centroid) * 0.15;
        // Entrance proximity only compares layouts on an equally suitable
        // axis. A distant market cannot rotate the church across a long lot.
        if (alignment > bestAlignment + 1e-8 || Math.abs(alignment - bestAlignment) <= 1e-8 && score > bestScore) {
          bestAlignment = alignment; bestScore = score; best = { parts, hallWidth: width };
        }
      }
    }
    if (best) return best;
  }
  return null;
}
