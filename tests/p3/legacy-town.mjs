// Test-only conversion of immutable P1 Haxe snapshots. Never calls the TS generator.
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
export function legacyTown(seed, size) {
  const fixture = JSON.parse(gunzipSync(readFileSync(new URL(`../fixtures/p1/legacy/seed-${seed}-size-${size}.json.gz`, import.meta.url))));
  const snapshot = fixture.attempts.at(-1).stages.at(-1);
  const ring = ids => ids.map(id => `v${id}`), buildings = [], features = [], walls = [], gates = [];
  const districts = snapshot.patches.map(p => ({ id: `d${p.id}`, boundary: ring(p.boundary), wardType: p.ward.split('.').at(-1), withinCity: p.withinCity, withinWalls: p.withinWalls }));
  for (const p of snapshot.patches) for (const boundary of p.geometry) {
    const type = p.ward.split('.').at(-1), districtId = `d${p.id}`;
    if (type === 'Park' || type === 'Market') features.push({ id: `f${features.length}`, districtId, boundary: ring(boundary), kind: type === 'Park' ? 'grove' : boundary.length === 16 ? 'fountain' : 'statue' });
    else buildings.push({ id: `b${buildings.length}`, districtId, boundary: ring(boundary) });
  }
  for (const [kind, value] of [['city', snapshot.wall], ['castle', snapshot.castleWall]]) if (value) {
    const id = `w${walls.length}`, gateIds = [];
    for (const vertexId of ring(value.gates)) { const gid = `g${gates.length}`; gateIds.push(gid); gates.push({ id: gid, wallId: id, vertexId }); }
    walls.push({ id, kind, boundary: ring(value.boundary), activeSegments: value.segments, gateIds, towerVertexIds: ring(value.towers) });
  }
  const roads = [];
  for (const [kind, paths] of [['street', snapshot.streets], ['external', snapshot.roads]]) for (const path of paths) if (path.length > 1) roads.push({ id: `r${roads.length}`, kind, width: 2, vertexIds: ring(path) });
  const vertices = snapshot.vertices.map(v => ({ ...v, id: `v${v.id}` }));
  const center = snapshot.vertices[snapshot.center];
  const cityIds = new Set(snapshot.patches.filter(p => p.withinCity).flatMap(p => p.boundary));
  let radius = 0; for (const id of cityIds) { const v = snapshot.vertices[id]; radius = Math.max(radius, Math.sqrt(v.x * v.x + v.y * v.y)); }
  return { radius, town: {
    schemaVersion: '1', generatorVersion: '0.2.0-legacy', request: { seed, size, plaza: 'auto', castle: 'auto', walls: 'auto', maxAttempts: 20 },
    resolved: { seed, size, ...snapshot.features, attempts: fixture.attempts.length }, vertices, districts, buildings, features, walls, gates, roads, entrances: ring(snapshot.gates),
    center: { x: center.x, y: center.y }, bounds: { minX: Math.min(...vertices.map(v => v.x)), minY: Math.min(...vertices.map(v => v.y)), maxX: Math.max(...vertices.map(v => v.x)), maxY: Math.max(...vertices.map(v => v.y)) },
  } };
}
