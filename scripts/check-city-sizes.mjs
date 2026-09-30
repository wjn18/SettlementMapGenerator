import { mkdirSync, writeFileSync } from 'node:fs';
import { generateTown, validateTown, estimatePopulation } from '../packages/core/dist/index.js';

const cases = [], failures = [];
for (const seed of [1, 42, 12345, 352656828, 682063530]) for (const size of [60, 80, 100])
  for (const water of [{}, { river: true }, { coast: 'east' }, { coast: 'west', river: true }]) for (const walls of [false, true]) {
    const options = { seed, size, castle: true, plaza: true, walls, ...water }, start = performance.now();
    try {
      const result = generateTown(options);
      if (!result.ok) { failures.push({ options, error: result.error }); continue; }
      const town = result.town; validateTown(town);
      const population = estimatePopulation(town);
      cases.push({ options, ms: Math.round(performance.now() - start), attempts: town.resolved.attempts, districts: town.districts.filter(d => d.withinCity).length, buildings: town.buildings.length, population: population.total.residents });
    } catch (error) { failures.push({ options, error: String(error) }); }
  }
mkdirSync('artifacts/city-sizes', { recursive: true });
const summary = { cases: cases.length, failures: failures.length, maxMs: Math.max(...cases.map(c => c.ms)), maxAttempts: Math.max(...cases.map(c => c.attempts)) };
writeFileSync('artifacts/city-sizes/batch.json', JSON.stringify({ summary, cases, failures }, null, 2));
console.log(JSON.stringify({ ...summary, failedCases: failures }, null, 2));
if (failures.length) process.exitCode = 1;
