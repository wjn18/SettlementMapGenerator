import { mkdirSync, writeFileSync } from 'node:fs';
import { generateTown, validateTown, serializeTown, deserializeTown } from '../packages/core/dist/index.js';
const failures = [], cases = []; let maxAttempts = 0;
for (const seed of [1, 42, 12345, 352656828, 682063530]) for (const size of [6, 15, 24, 40])
  for (const coast of [false, 'east', 'south', 'west', 'north', 'auto']) for (const river of [false, true]) {
    if (!coast && !river) continue;
    const options = { seed, size, coast, river, castle: true, plaza: true, walls: true };
    const result = generateTown(options);
    if (!result.ok) { failures.push({ options, error: result.error }); continue; }
    try {
      validateTown(result.town); deserializeTown(serializeTown(result.town));
      maxAttempts = Math.max(maxAttempts, result.town.resolved.attempts);
      cases.push({ options, attempts: result.town.resolved.attempts });
    } catch (e) { failures.push({ options, error: e.message }); }
  }
mkdirSync('artifacts/terrain', { recursive: true });
writeFileSync('artifacts/terrain/batch.json', JSON.stringify({ cases, failures }, null, 2));
console.log(JSON.stringify({ cases: cases.length, failures: failures.length, maxAttempts, examples: failures.slice(0, 6) }, null, 2));
if (failures.length) process.exitCode = 1;
