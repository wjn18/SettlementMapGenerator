import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

test('Archived FIFO harness: 18 P1 fixtures still match; P4 output validates independently', async () => {
  const root = new URL('../../', import.meta.url);
  const server = createServer((req, res) => {
    try {
      const path = new URL(`.${req.url}`, root);
      if (!path.href.startsWith(root.href)) throw new Error('Invalid path');
      res.setHeader('Content-Type', 'text/javascript'); res.end(readFileSync(path));
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
    const page = await browser.newPage(), base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${base}/packages/core/dist/context.js`);
    const directory = new URL('../fixtures/p1/legacy/', import.meta.url);
    for (const file of readdirSync(directory).filter(f => f.endsWith('.json.gz'))) {
      const expected = JSON.parse(gunzipSync(readFileSync(new URL(file, directory))));
      const actual = await page.evaluate(async ({ base, seed, size }) => {
        const { GenerationContext, RetryableError } = await import(`${base}/packages/core/dist/context.js`);
        const { Model } = await import(`${base}/packages/core/dist/model.js`);
        const { generateTown, validateTown } = await import(`${base}/packages/core/dist/index.js`);
        const { snapshot } = await import(`${base}/tests/core/legacy-snapshot.mjs`);
        const { installLegacyPaths } = await import(`${base}/tests/core/legacy-path.mjs`);
        const { installLegacyCastles } = await import(`${base}/tests/core/legacy-castle.mjs`);
        const restore = installLegacyPaths();
        const restoreCastles = installLegacyCastles();
        const context = new GenerationContext(seed), r = context.random;
        const model = new Model(context, size, { plaza: r.bool(), castle: r.bool(), walls: r.bool() }), attempts = [];
        for (let i = 0; i < 20; i++) {
          const attempt = { stages: [], error: null }; attempts.push(attempt);
          try { for (const stage of model.build()) attempt.stages.push(snapshot(stage, model)); break; }
          catch (e) { if (!(e instanceof RetryableError)) throw e; attempt.error = e.message; }
        }
        restore();
        restoreCastles();
        const generated = generateTown({ seed, size });
        if (!generated.ok) throw new Error(JSON.stringify(generated.error));
        validateTown(generated.town);
        if (JSON.stringify(generated) !== JSON.stringify(generateTown({ seed, size }))) throw new Error('Nondeterministic browser output');
        return { attempts, state: r.state };
      }, { base, seed: expected.seed, size: expected.size });
      function compare(a, b, path = file) {
        if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') { assert.equal(a, b, path); return; }
        assert.equal(Object.keys(a).length, Object.keys(b).length, `${path} count`);
        for (const key of Object.keys(b)) compare(a[key], b[key], `${path}/${key}`);
      }
      compare(actual.attempts, expected.attempts);
      assert.equal(actual.state, expected.finalRandomState);
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
