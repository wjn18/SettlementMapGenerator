import test from 'node:test';
import assert from 'node:assert/strict';
import { Point, Polygon, containsPolygon } from '../../packages/core/dist/geometry.js';
import { fitCathedral } from '../../packages/core/dist/cathedral.js';

const polygon = points => new Polygon(points.map(([x, y]) => new Point(x, y)));
const rectangle = (width, height) => polygon([[0, 0], [width, 0], [width, height], [0, height]]);
const axisOf = shape => shape.map((point, index) => shape[(index + 1) % shape.length].subtract(point))
  .sort((a, b) => b.length - a.length)[0].norm();
const part = (layout, role) => layout.parts.find(item => item.role === role).shape;
function checked(block, options) {
  const layout = fitCathedral(block, options);
  assert.ok(layout, 'The usable church site must retain a regular layout.');
  assert.equal(layout.parts.filter(item => item.role === 'main_hall').length, 1);
  assert.equal(layout.parts.filter(item => item.role === 'bell_tower').length, 1);
  assert.ok(layout.parts.every(item => containsPolygon(block, item.shape)));
  return layout;
}

test('a market beyond the short side cannot turn a church across a long parcel', () => {
  for (const rotation of [0, .73, 1.31]) {
    const block = rectangle(60, 30);
    const frontage = new Point(30, 300);
    block.rotate(rotation);
    const target = new Polygon([frontage]); target.rotate(rotation);
    const before = block.map(point => [point.x, point.y]);
    const layout = checked(block, { frontage: target[0] });
    const axis = axisOf(part(layout, 'main_hall'));
    assert.ok(Math.abs(axis.dot(new Point(Math.cos(rotation), Math.sin(rotation)))) > .999999,
      'The nave follows the parcel long direction even when the market lies across its short side.');
    assert.deepEqual(block.map(point => [point.x, point.y]), before);
  }
});

test('nearby street frontage selects the entrance end without rotating the long-axis nave', () => {
  const block = rectangle(60, 30);
  const remoteMarket = new Point(30, 1000);
  for (const [streetX, direction] of [[-1, -1], [61, 1]]) {
    const frontages = [[new Point(streetX, 0), new Point(streetX, 30)]];
    const layout = checked(block, { frontage: remoteMarket, frontages });
    const hall = part(layout, 'main_hall'), tower = part(layout, 'bell_tower');
    assert.ok(Math.abs(axisOf(hall).x) > .999999);
    assert.ok((tower.centroid.x - hall.centroid.x) * direction > 0,
      'The entrance tower belongs at the end facing the adjacent street.');
    const differentMarket = checked(block, { frontage: new Point(-3000, -4000), frontages });
    assert.deepEqual(differentMarket, layout,
      'A remote market must not displace the local street connection.');
  }
});

test('an obstructed long direction falls back to a full-width layout in the available corridor', () => {
  const block = rectangle(60, 30);
  // Only this vertical strip is buildable. A long-axis church cannot cross
  // either obstruction, while a regular nave and tower fit along the strip.
  const accepts = shape => shape.every(point => point.x >= 25 && point.x <= 35);
  const layout = checked(block, { accepts, frontage: new Point(30, 40) });
  assert.ok(layout.parts.every(item => accepts(item.shape)));
  assert.ok(Math.abs(axisOf(part(layout, 'main_hall')).y) > .999999);
  assert.equal(layout.hallWidth, 7, 'The usable alternate direction avoids shrinking the nave.');
});

test('tiny differences in near-square parcels do not force a different church axis', () => {
  const frontage = new Point(25, 200);
  const axes = [rectangle(50, 50), rectangle(50.01, 50), rectangle(50, 50.01)]
    .map(block => axisOf(part(checked(block, { frontage }), 'main_hall')));
  assert.ok(axes.every(axis => Math.abs(axis.dot(axes[0])) > .999999));
  assert.ok(Math.abs(axes[0].y) > .999999,
    'With no meaningful parcel long axis, the entrance target can decide.');
});

test('the reported inland river church parcel uses its broad direction despite the market across the river', () => {
  // Original d58 parcel in exported metres, converted to planner units.
  const block = polygon([
    [-31.808207, -129.910505], [-35.120934, -170.740911],
    [-62.182005, -245.801437], [-62.674087, -247.166347],
    [85.330876, -207.618287], [106.892236, -201.856927],
    [126.601388, -201.579051], [120.637123, -127.252710],
    [47.801461, -128.522557],
  ]);
  block.forEach(point => point.scaleEq(.25));
  const layout = checked(block, { frontage: new Point(-62.294188 / 4, 84.276797 / 4) });
  const axis = axisOf(part(layout, 'main_hall'));
  assert.ok(Math.abs(axis.x) > .9, 'The nave must not again occupy the parcel short north-south direction.');
});
