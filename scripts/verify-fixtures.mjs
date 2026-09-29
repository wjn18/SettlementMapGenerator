import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

const root = 'tests/fixtures/p1';
const report = JSON.parse(readFileSync(`${root}/legacy/report.json`, 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
const samples = new Set();
const observedFlags = { plaza: new Set(), castle: new Set(), walls: new Set() };
let font;
for (const sample of report.samples) {
  const name = `seed-${sample.seed}-size-${sample.size}`;
  assert(!samples.has(name), 'Duplicate baseline');
  samples.add(name);
  const bytes = gunzipSync(readFileSync(`${root}/legacy/${name}.json.gz`));
  assert.equal(hash(bytes), sample.stageSha256, `${name}: data hash`);
  const data = JSON.parse(bytes);
  assert.equal(data.seed, sample.seed);
  assert.equal(data.size, sample.size);
  assert.equal(data.attempts.length, sample.attempts);
  const final = data.attempts.at(-1);
  assert.equal(final.error, null);
  assert.deepEqual(final.stages.map(s => s.stage), ['buildPatches', 'optimizeJunctions', 'buildWalls', 'buildStreets', 'createWards', 'buildGeometry']);
  assert.equal(final.stages.at(-1).patches.length, sample.patches);
  assert.deepEqual(final.stages.at(-1).features, sample.features);
  for (const key of Object.keys(observedFlags)) observedFlags[key].add(sample.features[key]);
  font ??= data.font;
  assert.deepEqual(data.font, font);
  const png = readFileSync(`${root}/legacy/${name}-dpr1.png`);
  assert.equal(hash(png), sample.screenshotSha256);
  const image = PNG.sync.read(png);
  assert.equal(image.width, 800);
  assert.equal(image.height, 800);
}
assert.equal(samples.size, 18);
for (const seed of [1, 42, 12345, 682063530]) for (const size of [6, 15, 24, 40]) {
  assert(samples.has(`seed-${seed}-size-${size}`));
}
for (const flags of Object.values(observedFlags)) assert.equal(flags.size, 2, 'Missing feature on/off coverage');
const dpi = report.dpr2;
const highDpi = readFileSync(`${root}/legacy/seed-${dpi.seed}-size-${dpi.size}-dpr2.png`);
assert.equal(hash(highDpi), dpi.screenshotSha256);
assert.equal(PNG.sync.read(highDpi).width, 1600);
assert.equal(PNG.sync.read(highDpi).height, 1600);
for (const mode of ['dev', 'production']) for (const dpr of [1, 2]) {
  const probe = JSON.parse(readFileSync(`${root}/probe/${mode}-dpr${dpr}.json`, 'utf8'));
  assert.deepEqual(probe.font, font);
  assert.deepEqual(probe.errors, []);
  const png = PNG.sync.read(readFileSync(`${root}/probe/${mode}-dpr${dpr}.png`));
  assert.equal(png.width, 800 * dpr);
  assert.equal(png.height, 800 * dpr);
}
console.log('PASS: 18 legacy stage fixtures, 19 legacy screenshots, 4 OpenFL screenshots and font layouts.');
