import { writeFile } from 'node:fs/promises';
import { generateTown, serializeTown } from '@settlement/core';

const [seed = '12345', size = '24', output] = process.argv.slice(2);
const result = generateTown({ seed: Number(seed), size: Number(size) });
if (!result.ok) {
  process.stderr.write(`${JSON.stringify(result.error)}\n`);
  process.exitCode = 1;
} else {
  const json = serializeTown(result.town);
  if (output) {
    await writeFile(output, json + '\n');
    process.stdout.write(`Saved ${result.town.districts.length} districts, ${result.town.buildings.length} buildings to ${output}\n`);
  } else process.stdout.write(json + '\n');
}
