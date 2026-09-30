import { installLegacyPaths } from './legacy-path.mjs';
installLegacyPaths(); // Archived P2 parity only; public generation uses P4 Dijkstra.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { GenerationContext, RetryableError } from '../../packages/core/dist/context.js';
import { Model } from '../../packages/core/dist/model.js';
import { snapshot } from './legacy-snapshot.mjs';

const directory = new URL('../fixtures/p1/legacy/', import.meta.url);
for (const file of readdirSync(directory).filter(f => f.endsWith('.json.gz'))) {
  test(`Node legacy topology, retries and random stream: ${file}`, () => {
    const expected = JSON.parse(gunzipSync(readFileSync(new URL(file, directory))));
    const context = new GenerationContext(expected.seed), random = context.random;
    const model = new Model(context, expected.size, { plaza: random.bool(), castle: random.bool(), walls: random.bool() });
    const attempts = [];
    for (let i = 0; i < 20; i++) {
      const attempt = { stages: [], error: null }; attempts.push(attempt);
      try { for (const stage of model.build()) attempt.stages.push(snapshot(stage, model)); break; }
      catch (e) { if (!(e instanceof RetryableError)) throw e; attempt.error = e.message; }
    }
    // Locate the first mismatch without flooding test output with entire maps.
    function compare(a, b, path = '') {
      if (typeof a === 'number' && typeof b === 'number' && /\/vertices\/\d+\/[xy]$/.test(path)) {
        assert.ok(Math.abs(a - b) <= 1e-8, `${path}: ${a} vs ${b}`); return;
      }
      if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') { assert.equal(a, b, path); return; }
      assert.equal(Object.keys(a).length, Object.keys(b).length, `${path} key count`);
      for (const key of Object.keys(b)) compare(a[key], b[key], `${path}/${key}`);
    }
    // Math.sin/cos differ between Node 24 and Chrome 153. Tiny coordinate
    // differences can change ties in recursive ortho cuts; compare all stages
    // bit-for-bit in the baseline browser in tests/browser/core-baseline.test.mjs.
    const topology = list => list.map(a => ({ ...a, stages: a.stages.filter(s => s.stage !== 'buildGeometry') }));
    compare(topology(attempts), topology(expected.attempts));
    const geometryCounts = list => list.at(-1).stages.at(-1).patches.map(p => p.geometry.length);
    assert.deepEqual(geometryCounts(attempts), geometryCounts(expected.attempts));
    assert.equal(random.state, expected.finalRandomState);
  });
}
