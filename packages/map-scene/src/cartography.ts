import type { Bounds, Point2 } from '@settlement/core';
import type { DrawCommand, MapScene, Stroke, Viewport } from './index.js';
import type { MapTheme } from './themes.js';

export interface CartographyOptions {
  grid?: boolean; scale?: boolean; compass?: boolean;
  /** Metres per square; auto chooses an interval for the current zoom. */
  gridSize?: number | 'auto';
  /** Display convention only; no geometry is rescaled. Defaults to 1. */
  metersPerUnit?: number;
}
export interface MapCartography {
  grid: boolean; scale: boolean; compass: boolean;
  gridSize: number | 'auto'; metersPerUnit: number; ink: string; paper: string;
}
export type ScreenCommand = (DrawCommand | {
  kind: 'text'; text: string; position: Point2; fontSize: number;
  fill: string; align: 'left' | 'center' | 'right';
}) & { opacity?: number };
export interface CartographyLayer {
  kind: 'grid' | 'scale' | 'compass'; commands: ScreenCommand[];
  bounds?: Bounds; stepMeters?: number; distanceMeters?: number; lengthPixels?: number;
}

export function createCartography(theme: MapTheme, options: CartographyOptions): MapCartography {
  const gridSize = options.gridSize ?? 100, metersPerUnit = options.metersPerUnit ?? 1;
  if (gridSize !== 'auto' && (!Number.isFinite(gridSize) || gridSize <= 0)) throw new Error('Invalid grid spacing');
  if (!Number.isFinite(metersPerUnit) || metersPerUnit <= 0) throw new Error('Invalid map distance scale');
  for (const flag of [options.grid, options.scale, options.compass]) if (flag !== undefined && typeof flag !== 'boolean') throw new Error('Invalid cartography switch');
  return { grid: options.grid ?? true, scale: options.scale ?? true, compass: options.compass ?? true, gridSize, metersPerUnit, ink: theme.label ?? theme.dark, paper: theme.paper };
}

/** Round to a stable 1/2/5 distance for legible grid and scale intervals. */
function niceDistance(value: number, up: boolean): number {
  const power = 10 ** Math.floor(Math.log10(value)), fraction = value / power;
  const steps = up ? [1, 2, 5, 10] : [10, 5, 2, 1];
  return power * (steps.find(n => up ? n >= fraction - 1e-10 : n <= fraction + 1e-10) ?? 1);
}
export const formatMapDistance = (meters: number): string => `${Number((meters >= 1000 ? meters / 1000 : meters).toPrecision(4))} ${meters >= 1000 ? 'km' : 'm'}`;

/** Screen-space geometry shared by all renderers and image exports. North is -Y. */
export function layoutCartography(scene: MapScene, viewport: Viewport, width: number, height: number): CartographyLayer[] {
  const settings = scene.cartography;
  if (!settings || ![width, height, viewport.zoom, viewport.centerX, viewport.centerY].every(Number.isFinite) || width < 1 || height < 1 || viewport.zoom <= 0) return [];
  const pixelsPerMeter = viewport.zoom / settings.metersPerUnit;
  if (!Number.isFinite(pixelsPerMeter) || pixelsPerMeter <= 0) return [];
  const layers: CartographyLayer[] = [], ink = settings.ink, paper = settings.paper;
  const stroke = (lineWidth = 1): Stroke => ({ color: ink, width: lineWidth, units: 'screen', cap: 'butt', join: 'miter', miterLimit: 3 });
  const line = (a: Point2, b: Point2, lineWidth = 1): ScreenCommand => ({ kind: 'polyline', points: [a, b], stroke: stroke(lineWidth) });
  const text = (value: string, x: number, y: number, fontSize = 13, align: 'left' | 'center' | 'right' = 'center'): ScreenCommand => ({ kind: 'text', text: value, position: { x, y }, fontSize, fill: ink, align });
  if (settings.grid) {
    let stepMeters = settings.gridSize === 'auto' ? niceDistance(100 / pixelsPerMeter, true) : settings.gridSize;
    // Coarsen a fixed grid by whole powers of two when it becomes too dense.
    if (stepMeters * pixelsPerMeter < 40) stepMeters *= 2 ** Math.ceil(Math.log2(40 / (stepMeters * pixelsPerMeter)));
    const spacing = stepMeters * pixelsPerMeter, stepWorld = stepMeters / settings.metersPerUnit;
    const commands: ScreenCommand[] = [];
    if (Number.isFinite(spacing) && spacing > 0 && Number.isFinite(stepWorld)) {
      const minX = viewport.centerX - width / 2 / viewport.zoom, minY = viewport.centerY - height / 2 / viewport.zoom;
      const startX = (Math.ceil(minX / stepWorld) * stepWorld - minX) * viewport.zoom;
      const startY = (Math.ceil(minY / stepWorld) * stepWorld - minY) * viewport.zoom;
      // Bounded loops also protect consumers with extreme viewport values.
      for (let i = 0; i < Math.min(512, Math.ceil(width / spacing) + 1); i++) {
        const x = startX + i * spacing; if (x > width) break;
        commands.push({ ...line({ x, y: 0 }, { x, y: height }), opacity: 0.28 });
      }
      for (let i = 0; i < Math.min(512, Math.ceil(height / spacing) + 1); i++) {
        const y = startY + i * spacing; if (y > height) break;
        commands.push({ ...line({ x: 0, y }, { x: width, y }), opacity: 0.28 });
      }
    }
    layers.push({ kind: 'grid', stepMeters, commands });
  }
  const radius = Math.min(52, Math.max(26, width * 0.055), height * 0.14);
  const showCompass = settings.compass && width >= 200 && height >= 180;
  if (settings.scale && width >= 200 && height >= 150) {
    const available = Math.min(200, width - (showCompass ? radius * 2 + 98 : 64));
    if (available >= 60) {
      const distanceMeters = niceDistance(available / pixelsPerMeter, false), lengthPixels = distanceMeters * pixelsPerMeter;
      if (Number.isFinite(lengthPixels) && lengthPixels > 0) {
        const x = 24, y = height - 24, unit = distanceMeters >= 1000 ? 1000 : 1;
        const bounds = { minX: 10, maxX: x + lengthPixels + 16, minY: y - 38, maxY: y + 12 };
        const commands: ScreenCommand[] = [{ kind: 'polygon', points: [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY }], fill: paper, opacity: 0.9 }];
        commands.push(line({ x, y }, { x: x + lengthPixels, y }, 1.4));
        for (let i = 0; i <= 4; i++) commands.push(line({ x: x + lengthPixels * i / 4, y }, { x: x + lengthPixels * i / 4, y: y - (i % 2 === 0 ? 9 : 5) }, 1.4));
        commands.push(text('0', x, y - 16, 12));
        if (lengthPixels >= 125) commands.push(text(String(Number((distanceMeters / 2 / unit).toPrecision(4))), x + lengthPixels / 2, y - 16, 12));
        commands.push(text(formatMapDistance(distanceMeters), x + lengthPixels, y - 16, 12, 'right'));
        layers.push({ kind: 'scale', commands, bounds, distanceMeters, lengthPixels });
      }
    }
  }
  if (showCompass) {
    const x = width - radius - 24, y = height - radius - 22;
    const commands: ScreenCommand[] = [0.79, 0.89].map(f => ({ kind: 'circle', center: { x, y }, radius: radius * f, stroke: stroke(1.2) }));
    const polar = (angle: number, r: number): Point2 => ({ x: x + Math.cos(angle) * r, y: y + Math.sin(angle) * r });
    for (let i = 0; i < 8; i++) {
      const angle = -Math.PI / 2 + i * Math.PI / 4, tip = polar(angle, radius * (i % 2 ? 0.72 : 1));
      commands.push({ kind: 'polygon', points: [{ x, y }, polar(angle - Math.PI / 8, radius * 0.21), tip], fill: ink, stroke: stroke(0.7) });
      commands.push({ kind: 'polygon', points: [{ x, y }, tip, polar(angle + Math.PI / 8, radius * 0.21)], fill: paper, stroke: stroke(0.7) });
    }
    commands.push(text('N', x, y - radius - 11, 17));
    layers.push({ kind: 'compass', commands, bounds: { minX: x - radius - 5, maxX: x + radius + 5, minY: y - radius - 31, maxY: y + radius + 5 } });
  }
  return layers;
}
