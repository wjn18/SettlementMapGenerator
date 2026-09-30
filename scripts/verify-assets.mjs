import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Retained assets are checked against the original upstream manifest, not a new copy.
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('docs/upstream-manifest.json', root), 'utf8'));
for (const [current, original] of [
  ['assets/fonts/maroubra.png', 'Assets/maroubra.png'],
  ['LICENSE', 'LICENSE'],
]) {
  const expected = manifest.files.find(file => file.path === original);
  assert(expected, `Missing upstream manifest entry: ${original}`);
  let bytes = readFileSync(new URL(current, root));
  if (expected.encoding === 'utf8-lf') bytes = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, current);
}
console.log(`PASS: retained font and root LICENSE match upstream ${manifest.commit}.`);
