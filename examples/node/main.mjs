import { Worker } from 'node:worker_threads';
import { generateTown, serializeTown, deserializeTown } from '@settlement/core';
const options = { seed: 12345, size: 24 };
const result = generateTown(options);
if (!result.ok) throw new Error(JSON.stringify(result.error));
const json = serializeTown(result.town);
if (serializeTown(deserializeTown(json)) !== json) throw new Error('JSON round trip failed');
// Each worker owns its random stream. Terminate explicitly in long-lived apps.
const worker = new Worker(new URL('./worker.mjs', import.meta.url));
try {
  const reply = new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  worker.postMessage(options);
  const other = await reply;
  if (!other.ok || serializeTown(other.town) !== json) throw new Error('Worker isolation failed');
} finally { await worker.terminate(); }
console.log(JSON.stringify({ generatorVersion: result.town.generatorVersion, buildings: result.town.buildings.length, workerMatches: true }));
