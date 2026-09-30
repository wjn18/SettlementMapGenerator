import { getTownAtlas, distanceToPath } from '@settlement/core';
import type { TownData, Point2, Bounds } from '@settlement/core';
import type { MapTheme } from './themes.js';
import type { MapScene, Viewport } from './index.js';

export interface LabelCandidate { center: Point2; angle: number; width: number; bend: number }
export interface MapLabel {
  id: string; text: string; kind: 'city' | 'region'; fontSize: number;
  fill: string; halo: string; priority: number; districtIds: string[]; candidates: LabelCandidate[];
}
export interface LabelGlyph { text: string; x: number; y: number; angle: number; advance: number }
export interface PlacedLabel { id: string; text: string; kind: 'city' | 'region'; fontSize: number; fill: string; halo: string; haloWidth: number; glyphs: LabelGlyph[]; bounds: Bounds }
export const LABEL_FONT = 'Georgia, "Times New Roman", "Noto Serif CJK SC", SimSun, serif';
export const labelFont = (size: number, kind: MapLabel['kind']): string => `${kind === 'city' ? 'normal' : 'bold'} ${size}px ${LABEL_FONT}`;
export function labelPointInRing(ring: readonly Point2[], p: Point2): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const side = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(side) < 1e-7 && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + (p.y - a.y) * (b.x - a.x) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}
function ringCenter(ring: Point2[]): { center: Point2; area: number } {
  let area = 0, x = 0, y = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], cross = a.x * b.y - b.x * a.y; area += cross; x += (a.x + b.x) * cross; y += (a.y + b.y) * cross; }
  return { area: area / 2, center: { x: x / (3 * area), y: y / (3 * area) } };
}

export function buildMapLabels(town: TownData, theme: MapTheme): MapLabel[] {
  const atlas = getTownAtlas(town), vertices = new Map(town.vertices.map(v => [v.id, v]));
  const districts = new Map(town.districts.map(d => [d.id, d]));
  const cityPoints = town.districts.filter(d => d.withinCity).flatMap(d => d.boundary.map(id => vertices.get(id)!));
  const span = Math.max(Math.max(...cityPoints.map(p => p.x)) - Math.min(...cityPoints.map(p => p.x)), Math.max(...cityPoints.map(p => p.y)) - Math.min(...cityPoints.map(p => p.y)));
  const fill = theme.label ?? theme.dark, halo = theme.paper;
  const labels: MapLabel[] = [{ id: 'city-name', text: atlas.cityName, kind: 'city', fontSize: 36, fill, halo, priority: Infinity, districtIds: [], candidates: [] }];
  for (const region of atlas.regions) {
    const rings = region.districtIds.map(id => districts.get(id)!.boundary.map(id => vertices.get(id)!));
    const parts = rings.map(ringCenter), area = parts.reduce((sum, p) => sum + p.area, 0);
    const center = parts.reduce((c, p) => ({ x: c.x + p.center.x * p.area / area, y: c.y + p.center.y * p.area / area }), { x: 0, y: 0 });
    const points = rings.flat(), xx = points.reduce((s, p) => s + (p.x - center.x) ** 2, 0), yy = points.reduce((s, p) => s + (p.y - center.y) ** 2, 0), xy = points.reduce((s, p) => s + (p.x - center.x) * (p.y - center.y), 0);
    let angle = 0.5 * Math.atan2(2 * xy, xx - yy);
    angle = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, angle));
    const fontSize = Math.min(span * 0.044, Math.sqrt(area) * 0.23);
    const anchors = [center, ...parts.sort((a, b) => b.area - a.area).map(p => p.center)];
    // Alternative nearby anchors allow a label to move within its own region.
    for (const dy of [-1, 1]) for (const dx of [-1, 0, 1]) anchors.push({ x: center.x + dx * Math.sqrt(area) * 0.15, y: center.y + dy * Math.sqrt(area) * 0.15 });
    const candidates: LabelCandidate[] = [];
    for (const a of anchors.slice(0, 14)) for (const rotation of [angle, 0]) {
      const projections = points.map(p => (p.x - a.x) * Math.cos(rotation) + (p.y - a.y) * Math.sin(rotation));
      const width = (Math.max(...projections) - Math.min(...projections)) * 0.88;
      for (const curve of [0.1, -0.07, 0]) candidates.push({ center: { ...a }, angle: rotation, width, bend: width * curve });
    }
    labels.push({ id: region.id, text: region.name, kind: 'region', fontSize, fill, halo, districtIds: [...region.districtIds], priority: (region.kind === 'citadel' ? 1e8 : region.kind === 'harbor' ? 1e7 : 0) + area, candidates });
  }
  return labels;
}

/** Pure shared screen-space layout. Renderers provide font measurements; labels
 * use the same placements for preview and export, with no browser state in core. */
export function layoutMapLabels(scene: MapScene, viewport: Viewport, width: number, height: number, measure: (text: string, size: number, kind: MapLabel['kind']) => number): PlacedLabel[] {
  if (!scene.labels?.length) return [];
  const result: PlacedLabel[] = [], rings = new Map(scene.hitRegions.map(r => [r.entityId, r.points]));
  const screen = (p: Point2): Point2 => ({ x: width / 2 + (p.x - viewport.centerX) * viewport.zoom, y: height / 2 + (p.y - viewport.centerY) * viewport.zoom });
  const world = (p: Point2): Point2 => ({ x: viewport.centerX + (p.x - width / 2) / viewport.zoom, y: viewport.centerY + (p.y - height / 2) / viewport.zoom });
  const intersects = (a: Bounds, b: Bounds) => a.minX < b.maxX + 3 && a.maxX > b.minX - 3 && a.minY < b.maxY + 3 && a.maxY > b.minY - 3;
  const wet = (p: Point2) => (scene.terrain?.coast && labelPointInRing(scene.terrain.coast.water, p)) || (scene.river && (scene.river.surface ? labelPointInRing(scene.river.surface, p) : distanceToPath(p, scene.river.centerline) < scene.river.width / 2));
  for (const label of [...scene.labels].sort((a, b) => b.priority - a.priority)) {
    let chars = Array.from(label.text);
    let base = label.kind === 'city' ? Math.min(38, Math.max(22, width * 0.043)) : Math.min(30, label.fontSize * viewport.zoom);
    if (label.kind === 'city') {
      const available = Math.max(0, width - 70), naturalWidth = chars.reduce((sum, c) => sum + measure(c, base, label.kind), 0);
      base = Math.max(14, Math.min(base, base * available / Math.max(1, naturalWidth)));
      // Long names stay discoverable in the editor and SVG title even on narrow maps.
      let total = chars.reduce((sum, c) => sum + measure(c, base, label.kind), 0);
      if (total > available) {
        const ellipsis = measure('…', base, label.kind);
        while (chars.length && total + ellipsis > available) total -= measure(chars.pop()!, base, label.kind);
        chars.push('…');
      }
    }
    if (base < 9.5) continue;
    const candidates = label.kind === 'city' ? [{ center: world({ x: width / 2, y: 46 }), width: (width - 70) / viewport.zoom, angle: 0, bend: 0 }] : label.candidates;
    let placed = false;
    for (const factor of [1, 0.85, 0.7]) {
      if (placed) break;
      const size = base * factor;
      if (size < (label.kind === 'city' ? 14 : 9.5)) continue;
      const advances = chars.map(c => measure(c, size, label.kind) + (label.kind === 'city' ? 0 : size * 0.04));
      const total = advances.reduce((a, b) => a + b, 0), haloWidth = Math.max(1.4, size * 0.12);
      for (const candidate of candidates) {
        if (total > candidate.width * viewport.zoom) continue;
        const center = screen(candidate.center), cos = Math.cos(candidate.angle), sin = Math.sin(candidate.angle);
        // Quadratic arc sampled by arc length, keeping character spacing even.
        const path: { p: Point2; length: number }[] = []; let length = 0;
        for (let i = 0; i <= 64; i++) {
          const t = i / 64, x = (t - 0.5) * candidate.width * viewport.zoom, y = candidate.bend * viewport.zoom * (4 * (t - 0.5) ** 2 - 0.5);
          const p = { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos };
          if (i) length += Math.hypot(p.x - path[i - 1].p.x, p.y - path[i - 1].p.y);
          path.push({ p, length });
        }
        let cursor = (length - total) / 2; const glyphs: LabelGlyph[] = [], boxes: Point2[][] = [];
        for (let i = 0; i < chars.length; i++) {
          const at = cursor + advances[i] / 2; cursor += advances[i];
          const j = Math.max(1, path.findIndex(p => p.length >= at)), a = path[j - 1], b = path[j], t = (at - a.length) / (b.length - a.length || 1);
          const x = a.p.x + (b.p.x - a.p.x) * t, y = a.p.y + (b.p.y - a.p.y) * t, angle = Math.atan2(b.p.y - a.p.y, b.p.x - a.p.x);
          glyphs.push({ text: chars[i], x, y, angle, advance: advances[i] });
          const c = Math.cos(angle), s = Math.sin(angle), half = advances[i] / 2 + haloWidth;
          boxes.push([[-half, -size * 0.8 - haloWidth], [half, -size * 0.8 - haloWidth], [half, size * 0.2 + haloWidth], [-half, size * 0.2 + haloWidth]].map(([dx, dy]) => ({ x: x + dx * c - dy * s, y: y + dx * s + dy * c })));
        }
        const corners = boxes.flat(), bounds = { minX: Math.min(...corners.map(p => p.x)), maxX: Math.max(...corners.map(p => p.x)), minY: Math.min(...corners.map(p => p.y)), maxY: Math.max(...corners.map(p => p.y)) };
        if (bounds.minX < 8 || bounds.maxX > width - 8 || bounds.minY < 8 || bounds.maxY > height - 8 || result.some(other => intersects(bounds, other.bounds))) continue;
        if (label.kind === 'region') {
          const ownRings = label.districtIds.map(id => rings.get(id)!);
          // Keep the full lettering on its own land, away from water and bridges.
          if (corners.some(p => { const w = world(p); return wet(w) || !ownRings.some(r => labelPointInRing(r, w)); })) continue;
          if (glyphs.some(g => (scene.river?.bridges ?? []).some(b => distanceToPath(world(g), b.points) < b.width / 2 + size / viewport.zoom * 0.35))) continue;
        }
        result.push({ id: label.id, text: label.text, kind: label.kind, fontSize: size, fill: label.fill, halo: label.halo, haloWidth, glyphs, bounds }); placed = true; break;
      }
    }
  }
  return result;
}
