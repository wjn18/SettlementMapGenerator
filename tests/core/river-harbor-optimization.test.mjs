import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateTown, serializeTown } from '@settlement/core';
import { harborOverlap, harborRectangle } from '../../packages/core/dist/river-harbor.js';
import { distanceToPath } from '../../packages/core/dist/river.js';
import { inRing, intersection } from '../../packages/core/dist/terrain-geometry.js';

// Preserve the original full predicate as an oracle for the spatial rejection.
function exactOverlap(a, b, margin = 0) {
  const edges = ring => ring.map((p, i) => [p, ring[(i + 1) % ring.length]]);
  if (a.some(p => inRing(b, p)) || b.some(p => inRing(a, p))) return true;
  if (edges(a).some(([p, q]) => edges(b).some(([r, s]) => intersection(p, q, r, s)))) return true;
  return a.some(p => distanceToPath(p, [...b, b[0]]) <= margin) || b.some(p => distanceToPath(p, [...a, a[0]]) <= margin);
}

test('harbor spatial rejection preserves exact intersections, clearances and endpoint tolerances', () => {
  const rectangle = (x, y, width, height) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
  const fixed = [
    rectangle(0, 0, 1, 1), rectangle(1, 0, 1, 1), rectangle(1 + 5e-10, .5, 1, 1),
    rectangle(1 + 5e-8, .5, 1, 1), rectangle(.1, .1, .2, .2), rectangle(2, 2, 1, 1),
    rectangle(0, 0, 1e6, 1e6), rectangle(1e6 + .0005, .5e6, 1e6, 1e6),
    [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 4 }, { x: 0, y: 4 }],
  ];
  for (const a of fixed) for (const b of fixed) for (const margin of [0, 1e-9, .1, 1]) {
    assert.equal(harborOverlap(a, b, margin), exactOverlap(a, b, margin));
  }
  // Rotated dock/ship footprints exercise both intersecting and far-away pairs.
  let state = 48271;
  const random = () => (state = state * 48271 % 2147483647) / 2147483647;
  for (let i = 0; i < 400; i++) {
    const ring = () => {
      const x = random() * 40 - 20, y = random() * 40 - 20, angle = random() * Math.PI * 2, length = random() * 12 + .1;
      return harborRectangle({ x, y }, { x: x + Math.cos(angle) * length, y: y + Math.sin(angle) * length }, random() * 5 + .1);
    };
    const a = ring(), b = ring(), margin = random();
    assert.equal(harborOverlap(a, b, margin), exactOverlap(a, b, margin));
    assert.equal(harborOverlap(b, a, margin), exactOverlap(b, a, margin));
  }
});

test('public harbor overlap recomputes bounds when imported geometry is edited', () => {
  const a = harborRectangle({ x: 0, y: 0 }, { x: 4, y: 0 }, 2);
  const b = harborRectangle({ x: 20, y: 0 }, { x: 24, y: 0 }, 2);
  assert.equal(harborOverlap(a, b), false);
  for (const p of b) p.x -= 20;
  assert.equal(harborOverlap(a, b), true);
});

for (const [seed, riverHarbor, attempts, sha256] of [
  [358600429, true, 8, 'c6c73606e6a048506b0c02626066bb3a3f184717f116e6842afa07b4c55693ab'],
  [352656828, true, 1, '8a7b2f8e6e0855f9b68f14eed6a59d77985cf390c60838aeaf5f85cc4dc5aeea'],
  [682063530, true, 1, '05e6cfd6a20451a133cb15a73f242335530e9fd8e36701257f8de3a8c8fd8a4b'],
  [358600429, false, 1, 'af7b16e0ba0ca54ece286fa00db279e012384b5e224f07f97d7d3e8278ff7e25'],
]) test(`100 district harbor optimization preserves serialized town / ${seed} / ${riverHarbor}`, () => {
  const result = generateTown({ seed, size: 100, coast: 'east', river: true, harbor: true, riverHarbor, castle: true, plaza: true, walls: true, maxAttempts: 40 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.town.resolved.attempts, attempts);
  assert.equal(createHash('sha256').update(serializeTown(result.town)).digest('hex'), sha256);
});
