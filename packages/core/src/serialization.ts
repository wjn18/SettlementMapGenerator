import { normalizeOptions, OptionsError } from './options.js';
import { wardRegistry } from './wards.js';
import type { TownData, Point2, Vertex, Id } from './types.js';

export class TownDataError extends Error {
  readonly code = 'INVALID_TOWN_DATA';
  constructor(message: string) { super(message); this.name = 'TownDataError'; }
}
function fail(message: string): never { throw new TownDataError(message); }
type ObjectData = Record<string, unknown>;
function object(value: unknown, label: string, keys: string[]): ObjectData {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label}: expected object`);
  const data = value as ObjectData;
  if (Object.keys(data).length !== keys.length || keys.some(k => !Object.hasOwn(data, k))) fail(`${label}: invalid fields`);
  return data;
}
function array(value: unknown, label: string, max = 100_000): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(`${label}: invalid array or quantity limit exceeded`);
  return value as unknown[];
}
function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) fail(`${label}: invalid string`);
  return value as string;
}
function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label}: expected finite number`);
  return value as number;
}
function boolean(value: unknown, label: string): boolean { if (typeof value !== 'boolean') fail(`${label}: expected boolean`); return value as boolean; }
function choice(value: unknown, choices: readonly string[], label: string): string {
  const result = string(value, label); if (!choices.includes(result)) fail(`${label}: unsupported value`); return result;
}

/** Validates structure, bounds, positive rings and every cross-entity reference. */
export function validateTown(value: unknown): asserts value is TownData {
  const has = (value: unknown, key: string) => value !== null && typeof value === 'object' && Object.hasOwn(value, key);
  const town = object(value, 'town', ['schemaVersion', 'generatorVersion', 'request', 'resolved', 'vertices', 'districts', 'buildings', 'features', 'roads', 'walls', 'gates', 'entrances', 'center', 'bounds', ...(has(value, 'river') ? ['river'] : [])]);
  if (town.schemaVersion !== '1') fail('Unsupported schemaVersion');
  string(town.generatorVersion, 'generatorVersion');
  const rawRequest = object(town.request, 'request', ['seed', 'size', 'plaza', 'castle', 'walls', 'maxAttempts', ...(has(town.request, 'river') ? ['river'] : [])]);
  let request: ReturnType<typeof normalizeOptions>;
  try { request = normalizeOptions(rawRequest as unknown as TownData['request']); }
  catch (e) { if (e instanceof OptionsError) fail(e.message); throw e; }
  const resolved = object(town.resolved, 'resolved', ['seed', 'size', 'plaza', 'castle', 'walls', 'attempts']);
  if (resolved.seed !== request.seed || resolved.size !== request.size) fail('Request and resolved seed/size disagree');
  const attempts = number(resolved.attempts, 'attempts');
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > request.maxAttempts) fail('Invalid attempt count');
  for (const key of ['plaza', 'castle', 'walls'] as const) {
    boolean(resolved[key], key);
    if (request[key] !== 'auto' && resolved[key] !== request[key]) fail(`Resolved ${key} disagrees with request`);
  }
  const allIds = new Set<string>();
  function id(value: unknown): string { const key = string(value, 'id'); if (allIds.has(key)) fail(`Duplicate ID: ${key}`); allIds.add(key); return key; }
  const vertices = new Map<string, Point2>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const value of array(town.vertices, 'vertices', 250_000)) {
    const v = object(value, 'vertex', ['id', 'x', 'y']), key = id(v.id), x = number(v.x, 'x'), y = number(v.y, 'y');
    vertices.set(key, { x, y }); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (!vertices.size) fail('Empty vertex table');
  let references = 0;
  function vertexRef(value: unknown): string { const key = string(value, 'vertex ID'); if (!vertices.has(key)) fail(`Missing vertex: ${key}`); return key; }
  function refs(value: unknown, min: number, label: string): string[] {
    const values = array(value, label, 4096); references += values.length;
    if (values.length < min || references > 2_000_000) fail(`${label}: reference quantity limit`);
    return values.map(vertexRef);
  }
  function ring(value: unknown): string[] {
    const ids = refs(value, 3, 'ring');
    if (new Set(ids).size !== ids.length) fail('Ring repeats a vertex ID');
    let area = 0;
    for (let i = 0; i < ids.length; i++) { const a = vertices.get(ids[i])!, b = vertices.get(ids[(i + 1) % ids.length])!; area += a.x * b.y - b.x * a.y; }
    if (!Number.isFinite(area) || area <= 0) fail('Ring must have positive finite signed area');
    return ids;
  }
  const districts = new Set<string>();
  for (const value of array(town.districts, 'districts', 4096)) {
    const d = object(value, 'district', ['id', 'boundary', 'wardType', 'withinCity', 'withinWalls']); districts.add(id(d.id)); ring(d.boundary);
    const type = string(d.wardType, 'wardType'); if (!Object.hasOwn(wardRegistry, type)) fail('Unknown ward type');
    boolean(d.withinCity, 'withinCity'); boolean(d.withinWalls, 'withinWalls');
    if (d.withinWalls && (!d.withinCity || !resolved.walls)) fail('Invalid district wall membership');
  }
  if (!districts.size) fail('Empty districts');
  for (const kind of ['buildings', 'features'] as const) for (const value of array(town[kind], kind)) {
    const b = object(value, kind, kind === 'features' ? ['id', 'districtId', 'boundary', 'kind'] : ['id', 'districtId', 'boundary']);
    id(b.id); if (!districts.has(string(b.districtId, 'districtId'))) fail('Missing district reference'); ring(b.boundary);
    if (kind === 'features') choice(b.kind, ['grove', 'statue', 'fountain'], 'feature kind');
  }
  const roadIds = new Set<string>();
  for (const value of array(town.roads, 'roads', 4096)) {
    const r = object(value, 'road', ['id', 'kind', 'vertexIds', 'width']); roadIds.add(id(r.id)); choice(r.kind, ['street', 'external'], 'road kind');
    refs(r.vertexIds, 2, 'road vertices'); if (number(r.width, 'road width') <= 0) fail('Nonpositive road width');
  }
  const walls = new Map<string, { boundary: Set<string>; gateIds: string[] }>(), kinds = new Set<string>();
  for (const value of array(town.walls, 'walls', 2)) {
    const w = object(value, 'wall', ['id', 'kind', 'boundary', 'activeSegments', 'gateIds', 'towerVertexIds']);
    const key = id(w.id), kind = choice(w.kind, ['city', 'castle'], 'wall kind'), boundary = ring(w.boundary);
    if (kinds.has(kind)) fail('Duplicate wall kind'); kinds.add(kind);
    const active = array(w.activeSegments, 'activeSegments', 4096); if (active.length !== boundary.length) fail('Wall segment count mismatch');
    active.forEach(v => boolean(v, 'active segment'));
    const towers = refs(w.towerVertexIds, 0, 'towers'); if (towers.some(v => !boundary.includes(v))) fail('Tower outside wall boundary');
    const gates = array(w.gateIds, 'gate IDs', 4096).map(v => string(v, 'gate ID')); if (new Set(gates).size !== gates.length) fail('Duplicate wall gate');
    walls.set(key, { boundary: new Set(boundary), gateIds: gates });
  }
  if (kinds.has('city') !== resolved.walls || kinds.has('castle') !== resolved.castle) fail('Resolved walls disagree with geometry');
  const gates = new Map<string, { wallId: string; vertexId: string }>();
  for (const value of array(town.gates, 'gates', 4096)) {
    const g = object(value, 'gate', ['id', 'wallId', 'vertexId']), key = id(g.id), wallId = string(g.wallId, 'wallId'), vertexId = vertexRef(g.vertexId);
    const wall = walls.get(wallId);
    if (!wall || !wall.boundary.has(vertexId) || !wall.gateIds.includes(key)) fail('Invalid gate/wall reference');
    gates.set(key, { wallId, vertexId });
  }
  for (const [key, wall] of walls) for (const gate of wall.gateIds) if (gates.get(gate)?.wallId !== key) fail('Missing or mismatched gate');
  const entrances = refs(town.entrances, 0, 'entrances');
  for (const gate of gates.values()) if (!entrances.includes(gate.vertexId)) fail('Gate missing from entrances');
  const center = object(town.center, 'center', ['x', 'y']); number(center.x, 'center.x'); number(center.y, 'center.y');
  const bounds = object(town.bounds, 'bounds', ['minX', 'minY', 'maxX', 'maxY']);
  if (bounds.minX !== minX || bounds.minY !== minY || bounds.maxX !== maxX || bounds.maxY !== maxY) fail('Bounds disagree with vertices');
  if ((request.river === true) !== has(town, 'river')) fail('River geometry disagrees with request');
  if (has(town, 'river')) {
    const river = object(town.river, 'river', ['centerline', 'width', 'bankWidth', 'bridges']);
    const positive = (value: unknown, label: string) => { const n = number(value, label); if (n <= 0 || n > 1000) fail(`Invalid ${label}`); return n; };
    const path = (value: unknown, label: string) => {
      const points = array(value, label, 512); if (points.length < 2) fail(`${label}: too few points`);
      let previous: Point2 | undefined;
      for (const entry of points) {
        const p = object(entry, label, ['x', 'y']), x = number(p.x, 'x'), y = number(p.y, 'y');
        if (x < minX - 1e-6 || x > maxX + 1e-6 || y < minY - 1e-6 || y > maxY + 1e-6) fail(`${label}: outside bounds`);
        if (previous && previous.x === x && previous.y === y) fail(`${label}: repeated adjacent point`);
        previous = { x, y };
      }
    };
    path(river.centerline, 'river centerline'); positive(river.width, 'river width'); positive(river.bankWidth, 'bank width');
    for (const value of array(river.bridges, 'bridges', 512)) {
      const bridge = object(value, 'bridge', ['id', 'roadId', 'points', 'width']); id(bridge.id);
      if (!roadIds.has(string(bridge.roadId, 'bridge road'))) fail('Missing bridge road');
      path(bridge.points, 'bridge path'); positive(bridge.width, 'bridge width');
    }
  }
}

// Fixed lexical key order makes serialized snapshots independent of object property order.
export function serializeTown(town: TownData): string {
  validateTown(town);
  return JSON.stringify(town, (_key: string, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    return value;
  });
}
export function deserializeTown(json: string): TownData {
  if (typeof json !== 'string' || json.length > 64_000_000) fail('JSON input exceeds 64 million characters');
  let value: unknown;
  try { value = JSON.parse(json); } catch { return fail('Invalid JSON'); }
  validateTown(value); return value;
}

/** ID membership is deliberately distinct from geometric point containment. */
export function hasVertexId(ring: readonly Id[], id: Id): boolean { return ring.includes(id); }
export function createVertexIndex(town: TownData): ReadonlyMap<Id, Vertex> { return new Map(town.vertices.map(v => [v.id, v])); }
/** Even/odd containment; points on an edge count as inside. No polygon holes. */
export function containsPoint(town: TownData, ring: readonly Id[], point: Point2): boolean {
  if (ring.length < 3 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const index = createVertexIndex(town); let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = index.get(ring[j]), b = index.get(ring[i]); if (!a || !b) fail('Missing vertex in containment ring');
    const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
    if (Math.abs(cross) <= 1e-9 && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
