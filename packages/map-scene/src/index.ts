// Drawing order and palettes ported from watabou/TownGeneratorOS mapping (GPL-3.0).
import { validateTown } from '@settlement/core';
import type { TownData, Point2, Bounds, Id } from '@settlement/core';
export interface Stroke { color: string; width: number; units: 'world' | 'screen'; cap: 'butt' | 'round' | 'square'; join: 'miter' | 'round' | 'bevel'; miterLimit: number }
export type DrawCommand =
  | { kind: 'polygon'; points: Point2[]; fill?: string; stroke?: Stroke }
  | { kind: 'polyline'; points: Point2[]; stroke: Stroke }
  | { kind: 'circle'; center: Point2; radius: number; fill?: string; stroke?: Stroke };
export interface MapTheme { paper: string; light: string; medium: string; dark: string; normalStroke: number; thickStroke: number }
export interface MapScene { bounds: Bounds; background: string; commands: DrawCommand[]; hitRegions: { entityId: Id; points: Point2[] }[] }
export interface Viewport { centerX: number; centerY: number; zoom: number }
/** CSS-pixel input and world-coordinate viewport; no rendering runtime types. */
export interface MapRenderer {
  render(scene: MapScene): void;
  setViewport(viewport: Viewport): void;
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  pick(cssX: number, cssY: number): string | null;
  dispose(): void;
}
export function pickScene(scene: MapScene | null, viewport: Viewport, width: number, height: number, x: number, y: number): string | null {
  if (!scene || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > width || y > height) return null;
  const p = { x: viewport.centerX + (x-width/2)/viewport.zoom, y: viewport.centerY + (y-height/2)/viewport.zoom };
  for (let i=scene.hitRegions.length-1;i>=0;i--) if (pointInRing(scene.hitRegions[i].points,p)) return scene.hitRegions[i].entityId;
  return null;
}
function theme(paper: string, light: string, medium: string, dark: string): Readonly<MapTheme> { return Object.freeze({ paper, light, medium, dark, normalStroke: 0.3, thickStroke: 1.8 }); }
export const THEMES = Object.freeze({
  parchment: theme('#ccc5b8', '#99948a', '#67635c', '#1a1917'),
  blueprint: theme('#455b8d', '#7383aa', '#a1abc6', '#fcfbff'),
  ancient: theme('#ccc5a3', '#a69974', '#806f4d', '#342414'),
  colour: theme('#fff2c8', '#d6a36e', '#869a81', '#4c5950'),
  ink: theme('#cccac2', '#9a979b', '#6c6974', '#130f26'),
  monochrome: theme('#ffffff', '#cccccc', '#888888', '#000000'),
});
export function buildMapScene(town: TownData, palette: MapTheme = THEMES.parchment): MapScene {
  validateTown(town);
  for (const key of ['paper', 'light', 'medium', 'dark'] as const) if (!/^#[0-9a-f]{6}$/i.test(palette[key])) throw new Error(`Invalid theme color: ${key}`);
  for (const key of ['normalStroke', 'thickStroke'] as const) if (!Number.isFinite(palette[key]) || palette[key] <= 0) throw new Error(`Invalid theme stroke: ${key}`);
  const vertices = new Map(town.vertices.map(v => [v.id, v]));
  const points = (ids: readonly Id[]): Point2[] => ids.map(id => { const v = vertices.get(id)!; return { x: v.x, y: v.y }; });
  const commands: DrawCommand[] = [];
  const stroke = (color: string, width: number, cap: Stroke['cap'] = 'round', join: Stroke['join'] = 'round'): Stroke => ({ color, width, units: 'world', cap, join, miterLimit: 3 });
  // Main streets inside the city are negative space, as in the legacy renderer.
  for (const road of town.roads) if (road.kind === 'external') {
    commands.push({ kind: 'polyline', points: points(road.vertexIds), stroke: stroke(palette.medium, road.width + palette.normalStroke, 'butt') });
    commands.push({ kind: 'polyline', points: points(road.vertexIds), stroke: stroke(palette.paper, Math.max(0.01, road.width - palette.normalStroke)) });
  }
  const geometry = new Map<Id, { boundary: Id[]; grove: boolean }[]>();
  for (const b of town.buildings) { if (!geometry.has(b.districtId)) geometry.set(b.districtId, []); geometry.get(b.districtId)!.push({ boundary: b.boundary, grove: false }); }
  for (const f of town.features) { if (!geometry.has(f.districtId)) geometry.set(f.districtId, []); geometry.get(f.districtId)!.push({ boundary: f.boundary, grove: f.kind === 'grove' }); }
  for (const district of town.districts) {
    const blocks = geometry.get(district.id) ?? [];
    if (district.wardType === 'Castle' || district.wardType === 'Cathedral') {
      const width = palette.normalStroke * (district.wardType === 'Castle' ? 4 : 2);
      for (const b of blocks) commands.push({ kind: 'polygon', points: points(b.boundary), stroke: stroke(palette.dark, width, 'round', 'miter') });
      for (const b of blocks) commands.push({ kind: 'polygon', points: points(b.boundary), fill: palette.light });
    } else for (const b of blocks) {
      commands.push({ kind: 'polygon', points: points(b.boundary), fill: b.grove ? palette.medium : palette.light, stroke: stroke(b.grove ? palette.medium : palette.dark, palette.normalStroke, 'round', 'miter') });
    }
  }
  for (const wall of [...town.walls].sort((a, b) => a.kind === b.kind ? 0 : a.kind === 'city' ? -1 : 1)) {
    const boundary = points(wall.boundary);
    if (wall.activeSegments.every(Boolean)) commands.push({ kind: 'polygon', points: boundary, stroke: stroke(palette.dark, palette.thickStroke) });
    else wall.activeSegments.forEach((active, i) => { if (active) commands.push({ kind: 'polyline', points: [boundary[i], boundary[(i + 1) % boundary.length]], stroke: stroke(palette.dark, palette.thickStroke) }); });
    for (const gateId of wall.gateIds) {
      const gate = town.gates.find(g => g.id === gateId)!, i = wall.boundary.indexOf(gate.vertexId), p = boundary[i];
      const before = boundary[(i + boundary.length - 1) % boundary.length], after = boundary[(i + 1) % boundary.length];
      let dx = after.x - before.x, dy = after.y - before.y; const length = Math.sqrt(dx * dx + dy * dy);
      if (length !== 0) { const s = palette.thickStroke * 1.5 / length; dx *= s; dy *= s; }
      commands.push({ kind: 'polyline', points: [{ x: p.x - dx, y: p.y - dy }, { x: p.x + dx, y: p.y + dy }], stroke: stroke(palette.dark, palette.thickStroke * 2, 'butt') });
    }
    for (const p of points(wall.towerVertexIds)) commands.push({ kind: 'circle', center: p, radius: palette.thickStroke * (wall.kind === 'castle' ? 1.5 : 1), fill: palette.dark });
  }
  return { bounds: { ...town.bounds }, background: palette.paper, commands, hitRegions: town.districts.map(d => ({ entityId: d.id, points: points(d.boundary) })) };
}
export function pointInRing(points: readonly Point2[], p: Point2): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i], cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
    if (Math.abs(cross) <= 1e-9 && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  } return inside;
}
export function fitViewport(bounds: Bounds, width: number, height: number, padding = 32): Viewport {
  return { centerX: (bounds.minX + bounds.maxX) / 2, centerY: (bounds.minY + bounds.maxY) / 2, zoom: Math.max(0.01, Math.min(Math.max(1, width - padding * 2) / Math.max(1, bounds.maxX - bounds.minX), Math.max(1, height - padding * 2) / Math.max(1, bounds.maxY - bounds.minY))) };
}
