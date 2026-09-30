import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown, validateTown, serializeTown, deserializeTown } from '../../packages/core/dist/index.js';
import { GenerationContext, RetryableError, ResourceLimitError } from '../../packages/core/dist/context.js';
import { Point, Polygon, containsPolygon } from '../../packages/core/dist/geometry.js';
import { mergeCastleParts, isRegularCastleFootprint, createCastleFootprint } from '../../packages/core/dist/castle.js';
import { Ward } from '../../packages/core/dist/wards.js';

const polygon = points => new Polygon(points.map(([x, y]) => new Point(x, y)));
const rect = (x, y, w, h) => polygon([[x,y],[x+w,y],[x+w,y+h],[x,y+h]]);

test('castle union removes full and partial shared edges and conserves area', () => {
  const parts = [rect(0,0,4,8), rect(4,0,6,3), rect(4,3,6,5)];
  const merged = mergeCastleParts(parts);
  assert(merged); assert.equal(merged.length, 4); assert.equal(merged.square, 80);
  for (const part of parts) assert(containsPolygon(merged, part));
  assert.deepEqual(parts.map(p => p.length), [4,4,4]);
  const lShape = mergeCastleParts([rect(0,0,10,5), rect(0,5,5,5)]);
  assert(lShape); assert.equal(lShape.length, 6); assert.equal(lShape.square, 75);
  assert(isRegularCastleFootprint(lShape, rect(0,0,10,10)));
});

test('castle union rejects disconnected, point-touching and holed collections', () => {
  assert.equal(mergeCastleParts([]), null);
  assert.equal(mergeCastleParts([rect(0,0,4,4), rect(5,0,4,4)]), null);
  assert.equal(mergeCastleParts([rect(0,0,4,4), rect(4,4,4,4)]), null);
  assert.equal(mergeCastleParts([rect(0,0,10,2),rect(0,8,10,2),rect(0,2,2,6),rect(8,2,2,6)]), null);
  assert.equal(mergeCastleParts([rect(0,0,4,4), rect(0,0,4,4)]), null);
});

test('castle shape filter rejects slivers, tiny keeps, spikes, deep notches and crossings', () => {
  const block = rect(0,0,20,20);
  for (const p of [
    rect(0,0,20,3), rect(0,0,3,3),
    polygon([[0,0],[10,0],[20,10],[10,1],[0,10]]),
    polygon([[0,0],[20,0],[20,20],[15,20],[15,4],[5,4],[5,20],[0,20]]),
    polygon([[0,0],[20,20],[0,20],[20,0]]),
    polygon([[0,0],[20,0],[20,20],[19.9,20],[19.9,19.9],[0,20]]),
  ]) assert.equal(isRegularCastleFootprint(p, block), false);
  const valid = rect(3,4,14,12); assert(isRegularCastleFootprint(valid, block));
  valid.rotate(0.7); block.rotate(0.7); assert(isRegularCastleFootprint(valid, block));
});

test('irregular castles retry locally, preserve the next district random state and stop at a budget', () => {
  const context = new GenerationContext(42), block = rect(0,0,10,10); let calls = 0, firstState;
  const result = createCastleFootprint(context, block, () => {
    context.random.float(); firstState ??= context.random.state;
    return ++calls === 1 ? [rect(0,0,2,2),rect(8,8,2,2)] : [rect(0,0,5,10),rect(5,0,5,10)];
  });
  assert.equal(calls, 2); assert.equal(result.square, 100); assert.equal(context.random.state, firstState);
  calls = 0;
  assert.throws(() => createCastleFootprint(context, block, () => { calls++; return [rect(0,0,10,1)]; }), RetryableError);
  assert.equal(calls, 64);
  assert.throws(() => createCastleFootprint(new GenerationContext(42, 0), block, () => [block]), ResourceLimitError);
});

test('generated inland, river, coastal and estuary castles export one regular building', () => {
  for (const seed of [1,42,12345,352656828,682063530]) for (const size of [6,15,24,40])
    for (const water of [{},{river:true},{coast:'east'},{coast:'west',river:true}]) {
      const options = { seed, size, castle: true, ...water }, result = generateTown(options);
      assert.equal(result.ok, true, JSON.stringify({ options, result }));
      const town = result.town; validateTown(town);
      const district = town.districts.find(d => d.wardType === 'Castle'); assert(district);
      const buildings = town.buildings.filter(b => b.districtId === district.id);
      assert.equal(buildings.length, 1, JSON.stringify(options));
      const index = new Map(town.vertices.map(v => [v.id, new Point(v.x,v.y)]));
      const outline = new Polygon(buildings[0].boundary.map(id => index.get(id)));
      const block = new Polygon(district.boundary.map(id => index.get(id))).shrinkEq(16);
      assert(isRegularCastleFootprint(outline, block), JSON.stringify(options));
      assert.equal(new Set(outline.map(p => `${p.x},${p.y}`)).size, outline.length);
      assert.deepEqual(deserializeTown(serializeTown(town)), town);
      assert.deepEqual(generateTown(options), result);
    }
});

test('rejecting a castle site lets the estuary retry without retaining removed districts', () => {
  const original = Ward.prototype.createGeometry; let rejected = false;
  try {
    Ward.prototype.createGeometry = function() {
      original.call(this);
      if (this.type === 'Castle' && !rejected) { rejected = true; throw new RetryableError('Rejected castle site'); }
    };
    const result = generateTown({ seed: 42, size: 40, castle: true, coast: 'west', river: true });
    assert(rejected); assert.equal(result.ok, true, JSON.stringify(result));
    validateTown(result.town); assert(result.town.resolved.attempts > 1);
    const district = result.town.districts.find(d => d.wardType === 'Castle');
    assert.equal(result.town.buildings.filter(b => b.districtId === district.id).length, 1);
  } finally { Ward.prototype.createGeometry = original; }
});
