import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown, serializeTown, deserializeTown, estimatePopulation } from '../../packages/core/dist/index.js';
import { GenerationContext, ResourceLimitError } from '../../packages/core/dist/context.js';
import { Point, Polygon, containsPolygon } from '../../packages/core/dist/geometry.js';
import { normalizeOptions } from '../../packages/core/dist/options.js';
import { isRegularCastleFootprint } from '../../packages/core/dist/castle.js';

test('larger geometry budgets remain finite and enforce their boundary', () => {
  const context = new GenerationContext(42, 2_000_000, 312_500);
  context.geometry(312_500); assert.throws(() => context.geometry(), ResourceLimitError);
  assert.throws(() => new GenerationContext(42).geometry(50_001), ResourceLimitError);
  assert.throws(() => new GenerationContext(42, 0, 312_500).step(), ResourceLimitError);
});


test('size normalization supports 100 parcels with bounded attempt defaults', () => {
  for (const size of [6, 12, 24, 40, 60, 80, 100]) {
    const options = normalizeOptions({ seed: 42, size });
    assert.equal(options.size, size); assert.equal(options.maxAttempts, size > 40 ? 40 : 20);
    assert.equal(normalizeOptions({ seed: 42, size, maxAttempts: 7 }).maxAttempts, 7);
  }
  for (const size of [5, 101, 12.5]) assert.throws(() => normalizeOptions({ seed: 42, size }));
});
