import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildMapScene, THEMES, pointInRing, fitViewport } from '../../packages/map-scene/dist/index.js';
import { serializeTown } from '../../packages/core/dist/index.js';
import { legacyTown } from './legacy-town.mjs';

for (const [seed, size] of [[42, 15], [1, 6], [12345, 24], [30000, 40]]) test(`immutable scene and legacy drawing layers ${seed}/${size}`, () => {
  const { town } = legacyTown(seed, size), before = serializeTown(town);
  const scene = buildMapScene(town), repeat = buildMapScene(town);
  assert.deepEqual(scene, repeat); assert.equal(serializeTown(town), before);
  assert.equal(scene.hitRegions.length, town.districts.length);
  const external = town.roads.filter(r => r.kind === 'external');
  for (let i = 0; i < external.length; i++) {
    assert.equal(scene.commands[i * 2].stroke.width, 2.3); assert.equal(scene.commands[i * 2 + 1].stroke.width, 1.7);
    assert.equal(scene.commands[i * 2].stroke.cap, 'butt');
  }
  const towers = scene.commands.filter(c => c.kind === 'circle');
  assert.equal(towers.length, town.walls.reduce((n, w) => n + w.towerVertexIds.length, 0));
  const tinted = buildMapScene(town, THEMES.blueprint); assert.equal(tinted.background, '#455b8d'); assert.equal(tinted.commands.length, scene.commands.length);
  scene.hitRegions[0].points[0].x += 100;
  assert.equal(serializeTown(town), before);
});
test('world containment, viewport fit and theme validation', () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.ok(pointInRing(points, { x: 5, y: 5 })); assert.ok(pointInRing(points, { x: 0, y: 5 })); assert.equal(pointInRing(points, { x: -1, y: 5 }), false);
  assert.deepEqual(fitViewport({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 300, 200, 0), { centerX: 50, centerY: 50, zoom: 2 });
  assert.throws(() => buildMapScene(legacyTown(42, 15).town, { ...THEMES.parchment, dark: 'red' }));
});
test('reviewed screenshot fixture hashes remain intact', () => {
  const directory = new URL('../fixtures/p3/', import.meta.url);
  const report = JSON.parse(readFileSync(new URL('report.json', directory), 'utf8'));
  assert.equal(report.screenshots.length, 6);
  for (const entry of report.screenshots) assert.equal(createHash('sha256').update(readFileSync(new URL(entry.file, directory))).digest('hex'), entry.sha256, entry.file);
});
