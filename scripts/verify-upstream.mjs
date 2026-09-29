import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// No npm dependencies or upstream checkout are needed for this offline check.
const root = fileURLToPath(new URL('../', import.meta.url));
const legacy = path.join(root, 'legacy/TownGeneratorOS');
const manifest = JSON.parse(readFileSync(path.join(root, 'docs/upstream-manifest.json'), 'utf8'));
const errors = [];

function digest(file, encoding) {
  let bytes = readFileSync(file);
  // Git on Windows may check out the upstream LF text as CRLF.
  if (encoding === 'utf8-lf') bytes = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'));
  return createHash('sha256').update(bytes).digest('hex');
}

function inventory(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = prefix + entry.name;
    // The original project.xml writes build products here.
    if (name === 'Export' && entry.isDirectory()) return [];
    if (entry.isDirectory()) return inventory(path.join(directory, entry.name), name + '/');
    return [name];
  });
}

const expected = new Set(manifest.files.map(entry => entry.path));
if (expected.size !== manifest.files.length || expected.size !== 64) {
  errors.push('Manifest must contain exactly 64 unique upstream files.');
}
for (const file of inventory(legacy)) {
  if (!expected.has(file)) errors.push(`Unexpected reference file: ${file}`);
}
for (const entry of manifest.files) {
  try {
    if (digest(path.join(legacy, entry.path), entry.encoding) !== entry.sha256) {
      errors.push(`Content mismatch: ${entry.path}`);
    }
  } catch (error) {
    errors.push(`Cannot read ${entry.path}: ${error.message}`);
  }
}
const license = manifest.files.find(entry => entry.path === 'LICENSE');
if (!license || digest(path.join(root, 'LICENSE'), license.encoding) !== license.sha256) {
  errors.push('Root LICENSE does not match the upstream license.');
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`PASS: ${expected.size} upstream files and root LICENSE match ${manifest.commit}.`);
  console.log('Text comparison normalizes CRLF to LF; binary files are compared byte for byte.');
}
