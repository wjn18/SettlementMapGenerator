// Drawing order and palettes ported from watabou/TownGeneratorOS mapping (GPL-3.0).
import { validateTown, distanceToPath } from '@settlement/core';
import type { TownData, Point2, Bounds, Id, River, Terrain } from '@settlement/core';
import { THEMES, validateTheme, roofColor, mixColor, districtColor, districtRoofColor } from './themes.js';
import type { MapTheme } from './themes.js';
import { buildMapLabels } from './labels.js';
import type { MapLabel } from './labels.js';
import { createCartography } from './cartography.js';
import type { CartographyOptions, MapCartography } from './cartography.js';
export { layoutCartography, formatMapDistance } from './cartography.js';
export type { CartographyOptions, MapCartography, CartographyLayer, ScreenCommand } from './cartography.js';
export { layoutMapLabels, labelFont, LABEL_FONT } from './labels.js';
export type { MapLabel, PlacedLabel, LabelGlyph } from './labels.js';
export { THEMES, THEME_LABELS, themeFromCityPalette, DISTRICT_STYLES, districtColor } from './themes.js';
export type { MapTheme } from './themes.js';
export interface Stroke { color: string; width: number; units: 'world' | 'screen'; cap: 'butt' | 'round' | 'square'; join: 'miter' | 'round' | 'bevel'; miterLimit: number }
export type DrawCommand =
  | { kind: 'polygon'; points: Point2[]; fill?: string; stroke?: Stroke }
  | { kind: 'polyline'; points: Point2[]; stroke: Stroke }
  | { kind: 'circle'; center: Point2; radius: number; fill?: string; stroke?: Stroke };
export interface MapScene { bounds: Bounds; background: string; commands: DrawCommand[]; hitRegions: { entityId: Id; points: Point2[] }[]; river?: River; terrain?: Terrain; labels?: MapLabel[]; cartography?: MapCartography }
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
  for (const dock of scene.terrain?.docks ?? []) if (distanceToPath(p, dock.points) <= dock.width / 2) return dock.districtId;
  for (const bridge of scene.river?.bridges ?? []) if (distanceToPath(p, bridge.points) <= bridge.width / 2) {
    const ends = [bridge.points[0], bridge.points[bridge.points.length - 1]].sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
    for (const end of ends) { const region = scene.hitRegions.find(r => pointInRing(r.points, end)); if (region) return region.entityId; }
  }
  if (scene.terrain?.coast && pointInRing(scene.terrain.coast.water, p)) return null;
  if (scene.river && (scene.river.surface ? pointInRing(scene.river.surface, p) : distanceToPath(p, scene.river.centerline) < scene.river.width / 2) && !scene.river.bridges.some(b => distanceToPath(p, b.points) <= b.width / 2)) return null;
  for (let i=scene.hitRegions.length-1;i>=0;i--) if (pointInRing(scene.hitRegions[i].points,p)) return scene.hitRegions[i].entityId;
  return null;
}
export interface SceneOptions { districtColors?: boolean; labels?: boolean; cartography?: CartographyOptions }
export function buildMapScene(town: TownData, palette: MapTheme = THEMES.parchment, options: SceneOptions = {}): MapScene {
  validateTown(town);
  validateTheme(palette);
  // The road-first layout exports metre coordinates at four times its planning
  // scale. Keep outline and wall symbols consistent with its building sizes.
  if (['0.8.0', '0.9.0'].includes(town.generatorVersion)) palette = { ...palette, normalStroke: palette.normalStroke * 4, thickStroke: palette.thickStroke * 4 };
  const zoning = options.districtColors === true;
  const detailedColors = zoning || [palette.roof, palette.tree, palette.water, palette.wall].some(color => color !== undefined);
  const vertices = new Map(town.vertices.map(v => [v.id, v]));
  const points = (ids: readonly Id[]): Point2[] => ids.map(id => { const v = vertices.get(id)!; return { x: v.x, y: v.y }; });
  const commands: DrawCommand[] = [];
  const stroke = (color: string, width: number, cap: Stroke['cap'] = 'round', join: Stroke['join'] = 'round'): Stroke => ({ color, width, units: 'world', cap, join, miterLimit: 3 });
  // Color enclosed city ground; open suburbs keep the paper ground so empty
  // yards do not expose the planning parcels as solid polygon tiles.
  for (const district of town.districts) {
    const green = district.wardType === 'Park' || district.wardType === 'Farm';
    const civic = district.wardType === 'Castle' || district.wardType === 'Market';
    const fill = zoning && (district.withinCity || green)
      ? mixColor(districtColor(palette, district.wardType), palette.paper, green ? 0.3 : civic ? 0.5 : 0.76)
      : green ? palette.green : town.generatorVersion === '0.9.0' && !district.withinWalls && !civic ? undefined : palette.road !== undefined && district.withinCity ? (civic ? palette.light : palette.road) : undefined;
    if (fill) commands.push({ kind: 'polygon', points: points(district.boundary), fill });
  }
  for (const road of town.roads) if (road.kind === 'external' || palette.road !== undefined || zoning) {
    if (palette.road !== undefined || zoning) {
      commands.push({ kind: 'polyline', points: points(road.vertexIds), stroke: stroke(palette.road ?? palette.paper, road.width) });
      continue;
    }
    commands.push({ kind: 'polyline', points: points(road.vertexIds), stroke: stroke(palette.medium, road.width + palette.normalStroke, 'butt') });
    commands.push({ kind: 'polyline', points: points(road.vertexIds), stroke: stroke(palette.paper, Math.max(0.01, road.width - palette.normalStroke)) });
  }
  const geometry = new Map<Id, { id: Id; boundary: Id[]; kind: 'building' | 'grove' | 'fountain' | 'statue' }[]>();
  const water = palette.water ?? mixColor(palette.medium, '#83b8c6', 0.6);
  if (town.terrain?.coast) {
    commands.push({ kind: 'polygon', points: town.terrain.coast.water.map(p => ({ ...p })), fill: water });
    commands.push({ kind: 'polyline', points: town.terrain.coast.shoreline.map(p => ({ ...p })), stroke: stroke(mixColor(palette.dark, water, 0.5), palette.normalStroke) });
  }
  if (town.river) {
    const river = town.river, path = river.centerline.map(p => ({ ...p }));
    const water = palette.water ?? mixColor(palette.medium, '#83b8c6', 0.6);
    if (river.surface) commands.push({ kind: 'polygon', points: river.surface.map(p => ({ ...p })), fill: water });
    else {
      commands.push({ kind: 'polyline', points: path, stroke: stroke(mixColor(palette.dark, palette.paper, 0.55), river.width + 2 * river.bankWidth + 0.35) });
      commands.push({ kind: 'polyline', points: path, stroke: stroke(palette.road ?? palette.light, river.width + 2 * river.bankWidth) });
      commands.push({ kind: 'polyline', points: path, stroke: stroke(water, river.width) });
    }
  }
  for (const b of town.buildings) { if (!geometry.has(b.districtId)) geometry.set(b.districtId, []); geometry.get(b.districtId)!.push({ id: b.id, boundary: b.boundary, kind: 'building' }); }
  for (const f of town.features) { if (!geometry.has(f.districtId)) geometry.set(f.districtId, []); geometry.get(f.districtId)!.push({ id: f.id, boundary: f.boundary, kind: f.kind }); }
  for (const district of town.districts) {
    const blocks = geometry.get(district.id) ?? [];
    if (detailedColors) {
      for (const b of blocks) {
        const fill = b.kind === 'grove' ? palette.tree ?? palette.medium : b.kind === 'fountain' ? palette.water ?? palette.light : b.kind === 'statue' ? palette.wall ?? palette.dark : zoning ? districtRoofColor(palette, district.wardType, town.resolved.seed, b.id) : roofColor(palette, town.resolved.seed, district.id, b.id);
        commands.push({ kind: 'polygon', points: points(b.boundary), fill, stroke: stroke(mixColor(fill, palette.dark, 0.45), palette.normalStroke, 'round', 'miter') });
      }
    } else if (district.wardType === 'Castle' || district.wardType === 'Cathedral') {
      const width = palette.normalStroke * (district.wardType === 'Castle' ? 4 : 2);
      for (const b of blocks) commands.push({ kind: 'polygon', points: points(b.boundary), stroke: stroke(palette.dark, width, 'round', 'miter') });
      for (const b of blocks) commands.push({ kind: 'polygon', points: points(b.boundary), fill: palette.light });
    } else for (const b of blocks) {
      commands.push({ kind: 'polygon', points: points(b.boundary), fill: b.kind === 'grove' ? palette.medium : palette.light, stroke: stroke(b.kind === 'grove' ? palette.medium : palette.dark, palette.normalStroke, 'round', 'miter') });
    }
  }
  for (const wall of [...town.walls].sort((a, b) => a.kind === b.kind ? 0 : a.kind === 'city' ? -1 : 1)) {
    const boundary = points(wall.boundary);
    if (wall.activeSegments.every(Boolean)) commands.push({ kind: 'polygon', points: boundary, stroke: stroke(palette.dark, palette.thickStroke) });
    else wall.activeSegments.forEach((active, i) => { if (active) commands.push({ kind: 'polyline', points: [boundary[i], boundary[(i + 1) % boundary.length]], stroke: stroke(palette.dark, palette.thickStroke) }); });
    if (palette.wall) {
      const innerStroke = stroke(palette.wall, Math.max(0.01, palette.thickStroke - 2 * palette.normalStroke));
      if (wall.activeSegments.every(Boolean)) commands.push({ kind: 'polygon', points: boundary, stroke: innerStroke });
      else wall.activeSegments.forEach((active, i) => { if (active) commands.push({ kind: 'polyline', points: [boundary[i], boundary[(i + 1) % boundary.length]], stroke: innerStroke }); });
    }
    for (const gateId of wall.gateIds) {
      const gate = town.gates.find(g => g.id === gateId)!, i = wall.boundary.indexOf(gate.vertexId), p = boundary[i];
      const before = boundary[(i + boundary.length - 1) % boundary.length], after = boundary[(i + 1) % boundary.length];
      let dx = after.x - before.x, dy = after.y - before.y; const length = Math.sqrt(dx * dx + dy * dy);
      if (length !== 0) { const s = palette.thickStroke * 1.5 / length; dx *= s; dy *= s; }
      const gatePoints = [{ x: p.x - dx, y: p.y - dy }, { x: p.x + dx, y: p.y + dy }];
      commands.push({ kind: 'polyline', points: gatePoints, stroke: stroke(palette.dark, palette.thickStroke * 2, 'butt') });
      if (palette.wall) commands.push({ kind: 'polyline', points: gatePoints, stroke: stroke(palette.wall, Math.max(0.01, palette.thickStroke * 2 - 2 * palette.normalStroke), 'butt') });
    }
    for (const p of points(wall.towerVertexIds)) commands.push({ kind: 'circle', center: p, radius: palette.thickStroke * (wall.kind === 'castle' ? 1.5 : 1), fill: palette.wall ?? palette.dark, ...(palette.wall ? { stroke: stroke(palette.dark, palette.normalStroke) } : {}) });
  }
  if (town.river) for (const bridge of town.river.bridges) {
    const path = bridge.points.map(p => ({ ...p }));
    commands.push({ kind: 'polyline', points: path, stroke: stroke(palette.dark, bridge.width + 0.5, 'butt') });
    commands.push({ kind: 'polyline', points: path, stroke: stroke(palette.road ?? palette.light, bridge.width, 'butt') });
  }
  for (const dock of town.terrain?.docks ?? []) {
    const path = dock.points.map(p => ({ ...p }));
    commands.push({ kind: 'polyline', points: path, stroke: stroke(palette.dark, dock.width + 0.45, 'butt') });
    commands.push({ kind: 'polyline', points: path, stroke: stroke(palette.road ?? palette.light, dock.width, 'butt') });
  }
  const river = town.river ? { ...town.river, ...(town.river.surface ? { surface: town.river.surface.map(p => ({ ...p })) } : {}), centerline: town.river.centerline.map(p => ({ ...p })), bridges: town.river.bridges.map(b => ({ ...b, points: b.points.map(p => ({ ...p })) })) } : undefined;
  const terrain = town.terrain ? { ...town.terrain, ...(town.terrain.coast ? { coast: { ...town.terrain.coast, shoreline: town.terrain.coast.shoreline.map(p => ({ ...p })), water: town.terrain.coast.water.map(p => ({ ...p })) } } : {}), waterfronts: town.terrain.waterfronts.map(w => ({ ...w })), docks: town.terrain.docks.map(d => ({ ...d, points: d.points.map(p => ({ ...p })) })) } : undefined;
  return { bounds: { ...town.bounds }, background: palette.paper, commands, hitRegions: town.districts.map(d => ({ entityId: d.id, points: points(d.boundary) })), ...(river ? { river } : {}), ...(terrain ? { terrain } : {}), ...(options.labels ? { labels: buildMapLabels(town, palette) } : {}), ...(options.cartography ? { cartography: createCartography(palette, options.cartography) } : {}) };
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
