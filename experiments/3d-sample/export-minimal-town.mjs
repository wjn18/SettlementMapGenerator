import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { generateTown, serializeTown, deserializeTown, validateTown } from '@settlement/core';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

// The same TownData contract used by the playground's JSON export is the 3D
// input. There is no image tracing, parcel editing, or geometry simplification.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
  return args[index + 1];
};
const known = new Set(['--input', '--output', '--seed', '--size']);
for (let i = 0; i < args.length; i += 2) if (!known.has(args[i])) throw new Error(`Unknown option ${args[i]}`);
const output = path.resolve(root, option('--output', 'artifacts/3d-minimal-city'));
const input = option('--input', null);
const requested = { seed: Number(option('--seed', '7')), size: Number(option('--size', '6')), walls: true, castle: false, plaza: true };
await fs.mkdir(output, { recursive: true });
let town;
if (input) town = deserializeTown(await fs.readFile(path.resolve(process.cwd(), input), 'utf8'));
else {
  const result = generateTown(requested);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  town = result.town;
}
validateTown(town);
const vertex = new Map(town.vertices.map(v => [v.id, { x: v.x, y: v.y }]));
const point = id => {
  const p = vertex.get(id);
  if (!p) throw new Error(`Missing vertex ${id}`);
  return { ...p };
};
const points = ids => ids.map(point);
const districtById = new Map(town.districts.map(d => [d.id, d]));
const districts = town.districts.map(d => ({ ...d, points: points(d.boundary) }));
const buildings = town.buildings.map(b => ({ ...b, wardType: districtById.get(b.districtId).wardType, points: points(b.boundary) }));
const features = town.features.map(f => ({ ...f, points: points(f.boundary) }));
const roads = town.roads.map(r => ({ ...r, sourceId: r.id, points: points(r.vertexIds), sourceSegments: r.vertexIds.slice(1).map((_, i) => i) }));
const walls = town.walls.map(w => ({ ...w, sourceId: w.id, points: points(w.boundary), closed: true,
  sourceSegments: w.boundary.map((_, i) => i),
  gatePoints: town.gates.filter(g => g.wallId === w.id).map(g => point(g.vertexId)), towerPoints: points(w.towerVertexIds),
}));
const bounds = { ...town.bounds };
// This is only the complete map's display extent/ground slab. No entity is
// clipped to it, and it is never interpreted as an extra defensive wall.
const cropPolygon = [
  { x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
  { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY },
];
const plazas = districts.filter(d => d.wardType === 'Market').map(d => ({ id: d.id, points: d.points }));
const sourceText = serializeTown(town) + '\n';
const sourceSha256 = createHash('sha256').update(sourceText).digest('hex');
const selection = {
  scope: 'whole-city',
  source: { file: 'source-town.json', kind: input ? 'playground-compatible-town-json' : 'generated-with-existing-core',
    options: town.request, sha256: sourceSha256,
    note: 'Complete TownData exported by the existing flat-map generator. No entities are selected out or clipped. Use --input to consume a JSON file exported by the playground.',
  },
  seed: town.resolved.seed, generatorVersion: town.generatorVersion, schemaVersion: town.schemaVersion,
  buildings, districts, roads, walls, features,
  gates: town.gates.map(g => ({ ...g, point: point(g.vertexId) })), entrances: town.entrances.map(id => ({ id, point: point(id) })),
  plaza: plazas[0] ?? null, plazas, bounds, center: { ...town.center }, cropPolygon,
  ...(town.river ? { river: town.river } : {}), ...(town.terrain ? { terrain: town.terrain } : {}), ...(town.atlas ? { atlas: town.atlas } : {}),
  stats: {
    buildingCount: buildings.length, originalBuildingCount: town.buildings.length,
    buildingCountsByDistrict: Object.fromEntries(districts.map(d => [d.id, buildings.filter(b => b.districtId === d.id).length])),
    selectedDistrictCount: districts.length, withinCityDistrictCount: districts.filter(d => d.withinCity).length,
    wallChainCount: walls.length, gateCount: town.gates.length, roadCount: roads.length, featureCount: features.length,
    unselectedBuildingsInsideCrop: [], buildingsClipped: [], suggestedMetersPerPlanUnit: 0.5,
    cropRule: 'NO CROP: every building, district, road, wall, gate, tower, feature, river and terrain entity is copied. All wall rings are CLOSED: closed=true and activeSegments.length=points.length. The final wall segment connects the last point back to the first; inactive segments remain genuine gate/opening gaps. cropPolygon is the original full map bounds only.',
  },
};

// These checks compare the adapter with the original semantic data, including
// the closing edge that was intentionally absent in the old cropped sample.
for (const [name, key] of [['buildings', 'boundary'], ['districts', 'boundary'], ['features', 'boundary'], ['roads', 'vertexIds'], ['walls', 'boundary']]) {
  assert.equal(selection[name].length, town[name].length, `${name}: entity count`);
  for (let i = 0; i < town[name].length; i++) {
    assert.equal(selection[name][i].id, town[name][i].id);
    assert.deepEqual(selection[name][i].points, points(town[name][i][key]), `${name}: exact source coordinates`);
  }
}
for (let i = 0; i < walls.length; i++) {
  assert.equal(walls[i].closed, true);
  assert.equal(walls[i].activeSegments.length, walls[i].points.length);
  assert.deepEqual(walls[i].activeSegments, town.walls[i].activeSegments);
  assert.deepEqual(walls[i].gatePoints, town.gates.filter(g => g.wallId === walls[i].id).map(g => point(g.vertexId)));
  assert.deepEqual(walls[i].towerPoints, points(town.walls[i].towerVertexIds));
}
assert.deepEqual(selection.river, town.river);
assert.deepEqual(selection.terrain, town.terrain);
await fs.writeFile(path.join(output, 'source-town.json'), sourceText);
await fs.writeFile(path.join(output, 'selection.json'), JSON.stringify(selection, null, 2) + '\n');

// Render the 2D counterpart using the actual shared map-scene and SVG renderer,
// in a real browser for text metrics. The server only listens on loopback and
// is closed before the script exits. No independent imitation renderer is used.
const server = await createServer({ root, configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'minimal-town-export-page', configureServer(vite) {
    vite.middlewares.use('/__minimal-town-export__', (_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><meta charset="utf-8"><style>html,body{margin:0}#map{width:1800px;height:1800px}</style><div id="map"></div>');
    });
  } }],
});
let browser;
let rendered;
try {
  await server.listen();
  browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1800 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__minimal-town-export__`);
  rendered = await page.evaluate(async ({ town }) => {
    const { buildMapScene, THEMES } = await import('/packages/map-scene/src/index.ts');
    const { createSVGRenderer } = await import('/packages/renderer-svg/src/index.ts');
    const scene = buildMapScene(town, THEMES.natural, { labels: false, districtColors: false });
    const renderer = createSVGRenderer(document.getElementById('map'));
    renderer.resize(1800, 1800, 1);
    renderer.render(scene);
    const b = town.bounds, padding = 80;
    const viewport = { centerX: (b.minX + b.maxX) / 2, centerY: (b.minY + b.maxY) / 2,
      zoom: Math.min((1800 - padding * 2) / (b.maxX - b.minX), (1800 - padding * 2) / (b.maxY - b.minY)) };
    renderer.setViewport(viewport);
    return { svg: renderer.exportSVG(), viewport, commandCount: scene.commands.length };
  }, { town });
  assert.deepEqual(pageErrors, []);
  await fs.writeFile(path.join(output, 'planning.svg'), rendered.svg);
  await page.locator('#map').screenshot({ path: path.join(output, 'planning.png') });
} finally {
  await browser?.close();
  await server.close();
}
const report = {
  passed: true, sourceSha256, source: input ? path.resolve(process.cwd(), input) : '@settlement/core.generateTown',
  generatorVersion: town.generatorVersion, options: town.request, resolved: town.resolved,
  minimumSupportedSize: 6, sizeMeaning: 'Generator growth setting; final named/city districts and building count can exceed this number.',
  counts: { buildings: buildings.length, districts: districts.length, cityDistricts: districts.filter(d => d.withinCity).length,
    roads: roads.length, walls: walls.length, gates: town.gates.length, towers: walls.reduce((sum, w) => sum + w.towerPoints.length, 0), features: features.length },
  districtTypes: Object.fromEntries([...new Set(districts.map(d => d.wardType))].map(type => [type, {
    districts: districts.filter(d => d.wardType === type).length, buildings: buildings.filter(b => b.wardType === type).length,
  }])),
  featureTypes: Object.fromEntries([...new Set(features.map(f => f.kind))].map(type => [type, features.filter(f => f.kind === type).length])),
  walls: walls.map(w => ({ id: w.id, kind: w.kind, closed: w.closed, segments: w.points.length,
    activeSegments: w.activeSegments.filter(Boolean).length, inactiveSegments: w.activeSegments.filter(x => !x).length, gates: w.gatePoints.length, towers: w.towerPoints.length })),
  hasRiver: Boolean(town.river), hasCoast: Boolean(town.terrain?.coast), dockCount: town.terrain?.docks.length ?? 0,
  coordinatePolicy: 'All XY coordinates and dimensions remain exactly as exported; display scale is applied only by the 3D scene builder.',
  omittedEntityCount: 0, clippedEntityCount: 0, originalBounds: bounds,
  plan: { renderer: '@settlement/map-scene.buildMapScene → @settlement/renderer-svg.createSVGRenderer', theme: 'natural',
    viewport: rendered.viewport, commandCount: rendered.commandCount, width: 1800, height: 1800 },
};
await fs.writeFile(path.join(output, 'adapter-verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, ...report }, null, 2));
