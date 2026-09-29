import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { serveDirectory } from './static-server.mjs';

const output = 'artifacts/p1/legacy';
mkdirSync(output, { recursive: true });
const original = await serveDirectory('artifacts/legacy-original/Export/html5/bin');
const observed = await serveDirectory('artifacts/legacy-instrumented/Export/html5/bin');
const browser = await chromium.launch({ channel: 'chrome' });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { browser: browser.version(), viewport: { width: 800, height: 800 }, samples: [] };
const expected = process.argv.includes('--verify') ? JSON.parse(readFileSync('tests/fixtures/p1/legacy/report.json', 'utf8')) : null;
const stages = ['buildPatches', 'optimizeJunctions', 'buildWalls', 'buildStreets', 'createWards', 'buildGeometry'];
async function visit(url, dpr, captureData) {
  const context = await browser.newContext({ viewport: report.viewport, deviceScaleFactor: dpr });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(url, { timeout: 30_000 });
    await page.waitForSelector('canvas', { timeout: 30_000 });
    if (captureData) await page.waitForFunction(() => !!window.__legacyBaseline, undefined, { timeout: 30_000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (errors.length) throw new Error(errors.join('\n'));
    // WebGL without preserveDrawingBuffer cannot be sampled after presentation.
    // Inspect the browser screenshot, leaving the original renderer untouched.
    const png = await page.screenshot();
    const decoded = PNG.sync.read(png);
    const colors = new Set();
    for (let i = 0; i < decoded.data.length; i += 4) colors.add(decoded.data.readUInt32BE(i));
    if (decoded.width !== 800 * dpr || decoded.height !== 800 * dpr || colors.size < 10) throw new Error('Empty or incorrectly sized legacy screenshot');
    return { png, data: captureData ? await page.evaluate(() => window.__legacyBaseline) : null };
  } finally { await context.close(); }
}
function validate(data) {
  const final = data.attempts.at(-1);
  if (final.error || final.stages.map(s => s.stage).join() !== stages.join()) throw new Error('Incomplete generation stages');
  for (const attempt of data.attempts) for (const stage of attempt.stages) {
    if (stage.vertices.some(v => !Number.isFinite(v.x) || !Number.isFinite(v.y))) throw new Error('Non-finite vertex');
    for (const patch of stage.patches) {
      if (patch.boundary.length < 3) throw new Error('Invalid patch ring');
      for (const ring of [patch.boundary, ...patch.geometry]) {
        if (ring.some(id => !Number.isInteger(id) || !stage.vertices[id])) throw new Error('Dangling vertex reference');
      }
    }
  }
}
try {
  const samples = process.argv.includes('--smoke') ? [[1, 6]] :
    [...[1, 42, 12345, 682063530].flatMap(seed => [6, 15, 24, 40].map(size => [seed, size])),
      [22245, 6], [30000, 40]];
  for (const [seed, size] of samples) {
    const query = `?seed=${seed}&size=${size}`;
    const name = `seed-${seed}-size-${size}`;
    const first = await visit(observed.url + query, 1, true);
    validate(first.data);
    const repeat = await visit(observed.url + query, 1, true);
    const bytes = Buffer.from(JSON.stringify(first.data));
    if (!bytes.equals(Buffer.from(JSON.stringify(repeat.data)))) throw new Error(`${name}: repeated stage data differs`);
    const reference = await visit(original.url + query, 1, false);
    if (!first.png.equals(reference.png)) throw new Error(`${name}: instrumentation changes the rendered output`);
    writeFileSync(`${output}/${name}.json.gz`, gzipSync(bytes, { level: 9 }));
    writeFileSync(`${output}/${name}-dpr1.png`, reference.png);
    const final = first.data.attempts.at(-1).stages.at(-1);
    const summary = { seed, size, attempts: first.data.attempts.length, features: final.features,
      patches: final.patches.length, geometries: final.patches.reduce((n, p) => n + p.geometry.length, 0),
      stageSha256: hash(bytes), screenshotSha256: hash(reference.png),
      repeatEqual: true, instrumentationPixelsEqual: true };
    if (expected) {
      const match = expected.samples.find(s => s.seed === seed && s.size === size);
      if (!match || match.stageSha256 !== summary.stageSha256) throw new Error(`${name}: stage data differs from the checked-in baseline`);
    }
    report.samples.push(summary);
    console.log(`PASS ${name}: ${summary.patches} patches, ${summary.geometries} geometries, ${summary.attempts} attempts`);
  }
  if (!process.argv.includes('--smoke')) {
    const highDpi = await visit(original.url + '?seed=12345&size=24', 2, false);
    writeFileSync(`${output}/seed-12345-size-24-dpr2.png`, highDpi.png);
    report.dpr2 = { seed: 12345, size: 24, screenshotSha256: hash(highDpi.png) };
  }
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
} finally { await browser.close(); await original.close(); await observed.close(); }
