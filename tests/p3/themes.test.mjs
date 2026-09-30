import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMapScene, THEMES, themeFromCityPalette, districtColor } from '../../packages/map-scene/dist/index.js';

const names = ['modern', 'turquoise', 'fairytale', 'tapestry', 'natural', 'june'];
const town = JSON.parse(readFileSync(new URL('../fixtures/p5/town-citadel.json', import.meta.url)));
const raw = name => JSON.parse(readFileSync(new URL(`../../packages/map-scene/src/palettes/city_${name}.json`, import.meta.url)));
const vertices = new Map(town.vertices.map(v => [v.id, { x: v.x, y: v.y }]));
const indices = new WeakMap();
const shape = (scene, boundary) => {
  if (!indices.has(scene)) {
    const index = new Map();
    for (const c of scene.commands) if (c.kind === 'polygon') {
      const key = JSON.stringify(c.points);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(c);
    }
    indices.set(scene, index);
  }
  return indices.get(scene).get(JSON.stringify(boundary.map(id => vertices.get(id)))) ?? [];
};

for (const name of names) test(`${name}: source colors, deterministic effects and unchanged geometry`, () => {
  const original = JSON.stringify(town), theme = THEMES[name], source = raw(name);
  for (const key of ['paper', 'light', 'dark', 'roof', 'road', 'water', 'green', 'tree', 'wall', 'label'])
    assert.equal(theme[key], source[`color${key[0].toUpperCase()}${key.slice(1)}`].toLowerCase());
  const scene = buildMapScene(town, theme);
  assert.deepEqual(buildMapScene(town, theme), scene);
  assert.equal(JSON.stringify(town), original);
  assert.deepEqual(scene.hitRegions, buildMapScene(town).hitRegions);
  assert.deepEqual(scene.bounds, town.bounds);
  assert.equal(scene.background, theme.paper);
  assert.ok(scene.commands.some(c => c.stroke?.color === theme.road));
  assert.ok(scene.commands.some(c => c.kind === 'circle' && c.fill === theme.wall));
  const flat = buildMapScene(town, { ...theme, tintStrength: 0, weathering: 0 });
  const fills = new Set();
  for (const building of town.buildings) {
    assert.equal(shape(flat, building.boundary).at(-1).fill, theme.roof);
    fills.add(shape(scene, building.boundary).at(-1).fill);
  }
  assert.ok(fills.size > 5, 'roofs have stable color variation');
  assert.notDeepEqual(scene, buildMapScene(town, { ...theme, weathering: 0 }));
  assert.notDeepEqual(scene, buildMapScene(town, { ...theme, tintStrength: 0 }));
  for (const feature of town.features) {
    const expected = feature.kind === 'grove' ? theme.tree : feature.kind === 'fountain' ? theme.water : theme.wall;
    assert.equal(shape(scene, feature.boundary).at(-1).fill, expected);
  }
  for (const district of town.districts.filter(d => ['Farm', 'Park'].includes(d.wardType)))
    assert.equal(shape(scene, district.boundary)[0].fill, theme.green);
  // Legacy themes retain their original, untextured drawing behavior.
  assert.deepEqual(buildMapScene(town, THEMES.parchment), buildMapScene(town));
});

test('independent feature channels and unsafe palette values', () => {
  const source = raw('june');
  assert.deepEqual(themeFromCityPalette(source), THEMES.june);
  for (const value of [null, [], {}, { ...source, colorRoof: 'red' }, { ...source, colorWater: '#123' },
    { ...source, tintStrength: '' }, { ...source, tintStrength: true }, { ...source, weathering: '101' },
    { ...source, weathering: '-1' }, { ...source, tintMethod: 'Unknown' }]) assert.throws(() => themeFromCityPalette(value));
  for (const override of [{ roof: 'red' }, { tree: null }, { weathering: NaN }, { tintStrength: Infinity }, { tintMethod: 'Unknown' }])
    assert.throws(() => buildMapScene(town, { ...THEMES.parchment, ...override }));
  const fountainTown = structuredClone(town);
  fountainTown.features.forEach(f => { f.kind = 'fountain'; });
  assert.ok(fountainTown.features.length);
  const scene = buildMapScene(fountainTown, { ...THEMES.parchment, water: '#123456' });
  for (const feature of fountainTown.features) assert.equal(shape(scene, feature.boundary).at(-1).fill, '#123456');
});

test('district use determines color, with distinct categories and stable building variation', () => {
  const original = JSON.stringify(town);
  const distance = (a, b) => Math.hypot(...[1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)));
  for (const palette of Object.values(THEMES)) {
    const scene = buildMapScene(town, palette, { districtColors: true });
    assert.deepEqual(scene, buildMapScene(town, palette, { districtColors: true }));
    assert.deepEqual(scene.hitRegions, buildMapScene(town, palette).hitRegions);
    const categories = ['CraftsmenWard', 'Slum', 'Castle', 'MerchantWard', 'AdministrationWard'];
    for (let i = 0; i < categories.length; i++) for (let j = i + 1; j < categories.length; j++)
      assert.ok(distance(districtColor(palette, categories[i]), districtColor(palette, categories[j])) > 45);
    for (const building of town.buildings) {
      const type = town.districts.find(d => d.id === building.districtId).wardType;
      assert.ok(distance(shape(scene, building.boundary).at(-1).fill, districtColor(palette, type)) < 52, 'variation stays close to category color');
    }
    // Assign the SAME geometry to different uses: the resulting building color must change.
    const building = town.buildings[0], changed = structuredClone(town);
    const district = changed.districts.find(d => d.id === building.districtId);
    const colors = categories.map(type => {
      district.wardType = type;
      return shape(buildMapScene(changed, palette, { districtColors: true }), building.boundary).at(-1).fill;
    });
    assert.equal(new Set(colors).size, categories.length);
    assert.deepEqual(buildMapScene(town, palette, { districtColors: false }), buildMapScene(town, palette));
  }
  assert.equal(JSON.stringify(town), original);
});
