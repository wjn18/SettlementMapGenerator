import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown, createTownAtlas, getTownAtlas, renameTown, serializeTown, deserializeTown, validateTown } from '../../packages/core/dist/index.js';

for (const seed of [1, 42, 12345, 352656828]) for (const options of [{ size: 6 }, { size: 40 }, { size: 24, coast: 'east', river: true }])
test(`named regions ${seed}/${JSON.stringify(options)} cover connected land without changing geometry`, () => {
  const result = generateTown({ seed, ...options }); assert.equal(result.ok, true);
  const town = result.town, before = JSON.stringify(town), atlas = createTownAtlas(town);
  assert.deepEqual(atlas, town.atlas); assert.equal(JSON.stringify(town), before);
  const city = town.districts.filter(d => d.withinCity), byId = new Map(city.map(d => [d.id, d]));
  const members = atlas.regions.flatMap(r => r.districtIds);
  assert.equal(new Set(members).size, members.length); assert.deepEqual([...members].sort(), city.map(d => d.id).sort());
  assert.equal(new Set(atlas.regions.map(r => r.name)).size, atlas.regions.length);
  assert.ok(atlas.regions.length < city.length);
  for (const region of atlas.regions) {
    const reached = new Set([region.districtIds[0]]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of region.districtIds) if (!reached.has(id)) {
        const a = byId.get(id).boundary;
        if ([...reached].some(other => { const b = byId.get(other).boundary; return a.some((v,i) => b.some((w,j) => v === b[(j+1)%b.length] && a[(i+1)%a.length] === w)); })) { reached.add(id); changed = true; }
      }
    }
    assert.equal(reached.size, region.districtIds.length);
    if (region.kind === 'citadel') assert.ok(region.districtIds.every(id => byId.get(id).wardType === 'Castle'));
    if (region.kind === 'harbor') assert.ok(region.districtIds.every(id => byId.get(id).wardType === 'Harbor'));
  }
  const renamed = renameTown(renameTown(town, 'city', ' 雾港 '), atlas.regions[0].id, '旧城商埠');
  assert.equal(renamed.atlas.cityName, '雾港'); assert.equal(renamed.atlas.regions[0].name, '旧城商埠');
  assert.equal(JSON.stringify(town), before);
  const { atlas: a, ...geometry } = town, { atlas: b, ...other } = renamed; assert.deepEqual(geometry, other);
  assert.deepEqual(deserializeTown(serializeTown(renamed)), renamed);
});

test('old JSON remains unchanged until a name edit; metadata is detached and strictly validated', () => {
  const town = generateTown({ seed: 42, size: 15 }).town; delete town.atlas;
  const before = serializeTown(town), atlas = getTownAtlas(town); atlas.regions[0].districtIds.push('missing');
  assert.equal(serializeTown(town), before); assert.equal(town.atlas, undefined);
  assert.equal(deserializeTown(before).atlas, undefined);
  const named = renameTown(town, 'city', '<港&湾>'); validateTown(named);
  for (const value of ['', '   ', 'x'.repeat(65), 'a\nB', '\u202Ebad', 'a\u2028b']) assert.throws(() => renameTown(town, 'city', value));
  assert.throws(() => renameTown(town, 'missing', 'New'));
  for (const change of [t => t.atlas.cityName = '', t => t.atlas.regions[0].districtIds.push('missing'), t => t.atlas.regions.push(t.atlas.regions[0]), t => t.atlas.regions.shift(), t => t.atlas.version = '2']) {
    const bad = structuredClone(named); change(bad); assert.throws(() => validateTown(bad));
  }
});
