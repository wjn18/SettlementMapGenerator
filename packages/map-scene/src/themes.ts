import modern from './palettes/city_modern.json' with { type: 'json' };
import turquoise from './palettes/city_turquoise.json' with { type: 'json' };
import fairytale from './palettes/city_fairytale.json' with { type: 'json' };
import tapestry from './palettes/city_tapestry.json' with { type: 'json' };
import natural from './palettes/city_natural.json' with { type: 'json' };
import june from './palettes/city_june.json' with { type: 'json' };

export interface MapTheme {
  paper: string; light: string; medium: string; dark: string;
  normalStroke: number; thickStroke: number;
  roof?: string; road?: string; water?: string; green?: string;
  wall?: string; tree?: string; label?: string;
  tintMethod?: 'Overlay' | 'Spectrum'; tintStrength?: number; weathering?: number;
}

const colorFields = ['paper', 'light', 'medium', 'dark', 'roof', 'road', 'water', 'green', 'wall', 'tree', 'label'] as const;
export function validateTheme(palette: MapTheme): void {
  for (const key of colorFields) {
    const value = palette[key];
    if (value === undefined && !['paper', 'light', 'medium', 'dark'].includes(key)) continue;
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Invalid theme color: ${key}`);
  }
  for (const key of ['normalStroke', 'thickStroke'] as const)
    if (!Number.isFinite(palette[key]) || palette[key] <= 0) throw new Error(`Invalid theme stroke: ${key}`);
  for (const key of ['tintStrength', 'weathering'] as const) {
    const value = palette[key];
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 100)) throw new Error(`Invalid theme effect: ${key}`);
  }
  if (palette.tintMethod !== undefined && palette.tintMethod !== 'Overlay' && palette.tintMethod !== 'Spectrum') throw new Error('Invalid theme tintMethod');
}

/** Adapter for the reference site's palette JSON; all ten source colors are retained. */
export function themeFromCityPalette(value: unknown): Readonly<MapTheme> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid city palette');
  const data = value as Record<string, unknown>;
  const color = (key: string): string => {
    const value = data[key];
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Invalid city palette color: ${key}`);
    return value.toLowerCase();
  };
  const amount = (key: string): number => {
    const value = data[key];
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) throw new Error(`Invalid city palette effect: ${key}`);
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 100) throw new Error(`Invalid city palette effect: ${key}`);
    return number;
  };
  if (data.tintMethod !== 'Overlay' && data.tintMethod !== 'Spectrum') throw new Error('Invalid city palette tintMethod');
  const result: MapTheme = {
    paper: color('colorPaper'), light: color('colorLight'), dark: color('colorDark'), medium: color('colorGreen'),
    roof: color('colorRoof'), road: color('colorRoad'), water: color('colorWater'), green: color('colorGreen'),
    wall: color('colorWall'), tree: color('colorTree'), label: color('colorLabel'),
    tintMethod: data.tintMethod, tintStrength: amount('tintStrength'), weathering: amount('weathering'),
    normalStroke: 0.3, thickStroke: 1.8,
  };
  validateTheme(result);
  return Object.freeze(result);
}

function theme(paper: string, light: string, medium: string, dark: string): Readonly<MapTheme> {
  return Object.freeze({ paper, light, medium, dark, normalStroke: 0.3, thickStroke: 1.8 });
}
export const THEMES = Object.freeze({
  parchment: theme('#ccc5b8', '#99948a', '#67635c', '#1a1917'),
  blueprint: theme('#455b8d', '#7383aa', '#a1abc6', '#fcfbff'),
  ancient: theme('#ccc5a3', '#a69974', '#806f4d', '#342414'),
  colour: theme('#fff2c8', '#d6a36e', '#869a81', '#4c5950'),
  ink: theme('#cccac2', '#9a979b', '#6c6974', '#130f26'),
  monochrome: theme('#ffffff', '#cccccc', '#888888', '#000000'),
  modern: themeFromCityPalette(modern), turquoise: themeFromCityPalette(turquoise),
  fairytale: themeFromCityPalette(fairytale), tapestry: themeFromCityPalette(tapestry),
  natural: themeFromCityPalette(natural), june: themeFromCityPalette(june),
});
export const THEME_LABELS: Readonly<Record<keyof typeof THEMES, string>> = Object.freeze({
  parchment: '旧羊皮纸', blueprint: '建筑蓝图', ancient: '古地图', colour: '田园彩绘', ink: '墨色', monochrome: '黑白',
  modern: '现代 · modern', turquoise: '绿松石 · turquoise', fairytale: '童话 · fairytale',
  tapestry: '织锦 · tapestry', natural: '自然 · natural', june: '六月 · june',
});

// Stable appearance noise only: never consumes the town generator's random stream.
function noise(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d); hash ^= hash >>> 15;
  return (hash >>> 0) / 4294967296;
}
const rgb = (color: string): number[] => [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16) / 255);
const hex = (channels: number[]): string => '#' + channels.map(c => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')).join('');
export function mixColor(a: string, b: string, amount: number): string {
  const other = rgb(b); return hex(rgb(a).map((c, i) => c * (1 - amount) + other[i] * amount));
}
/** Semantic colors: the same use always belongs to the same color family. */
export const DISTRICT_STYLES = Object.freeze({
  CraftsmenWard: { label: '工匠街区', color: '#c47b4f' },
  Slum: { label: '平民街区', color: '#aaa78a' },
  Castle: { label: '城堡', color: '#8053a2' },
  MerchantWard: { label: '商人街区', color: '#39956e' },
  AdministrationWard: { label: '行政区', color: '#577faa' },
  PatriciateWard: { label: '贵族街区', color: '#b96786' },
  MilitaryWard: { label: '军营', color: '#596776' },
  Cathedral: { label: '教堂', color: '#ab8fb6' },
  GateWard: { label: '城门街区', color: '#b7954d' },
  Market: { label: '集市广场', color: '#cfaf50' },
  Park: { label: '公园', color: '#56845d' },
  Farm: { label: '农庄', color: '#93a162' },
  Ward: { label: '乡野', color: '#a29b89' },
});
export function districtColor(palette: MapTheme, wardType: string): string {
  const style = Object.hasOwn(DISTRICT_STYLES, wardType) ? DISTRICT_STYLES[wardType as keyof typeof DISTRICT_STYLES] : DISTRICT_STYLES.Ward;
  // A light paper wash ties categories to the selected theme without losing their identity.
  return mixColor(style.color, palette.paper, 0.12);
}
export function districtRoofColor(palette: MapTheme, wardType: string, seed: number, building: string): string {
  const base = districtColor(palette, wardType);
  const variation = noise(`${seed}/${building}/district-wear`);
  // Keep variation within each category; random hue shifts would obscure land use.
  return mixColor(base, variation < 0.5 ? palette.dark : palette.paper,
    Math.abs(variation - 0.5) * 2 * (0.04 + Math.min(palette.weathering ?? 0, 30) / 300));
}
export function roofColor(palette: MapTheme, seed: number, district: string, building: string): string {
  const base = palette.roof ?? palette.light, strength = (palette.tintStrength ?? 0) / 100;
  const districtNoise = noise(`${seed}/${district}/tint`);
  let color = base;
  if (strength && palette.tintMethod === 'Overlay') {
    const tint = rgb(mixColor('#cf7443', '#e4c766', districtNoise));
    const overlay = hex(rgb(base).map((c, i) => c < 0.5 ? 2 * c * tint[i] : 1 - 2 * (1 - c) * (1 - tint[i])));
    color = mixColor(base, overlay, strength);
  } else if (strength && palette.tintMethod === 'Spectrum') {
    // Rotate hue around the base roof color, keeping its saturation and brightness.
    const c = rgb(base), max = Math.max(...c), min = Math.min(...c), delta = max - min;
    let hue = delta === 0 ? 0 : max === c[0] ? (c[1] - c[2]) / delta : max === c[1] ? (c[2] - c[0]) / delta + 2 : (c[0] - c[1]) / delta + 4;
    hue = ((hue + (districtNoise - 0.5) * strength * 12) % 6 + 6) % 6;
    const x = delta * (1 - Math.abs(hue % 2 - 1));
    const sectors = [[delta, x, 0], [x, delta, 0], [0, delta, x], [0, x, delta], [x, 0, delta], [delta, 0, x]];
    color = hex(sectors[Math.floor(hue)].map(c => c + min));
  }
  // Per-building fading is a portable approximation of the source weathering effect.
  const wear = (palette.weathering ?? 0) / 100;
  return wear ? mixColor(color, palette.paper, wear * noise(`${seed}/${building}/wear`)) : color;
}
