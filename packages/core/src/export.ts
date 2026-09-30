import { RetryableError } from './context.js';
import type { Point, Polygon } from './geometry.js';
import { containsPolygon } from './geometry.js';
import type { Model, CurtainWall } from './model.js';
import type { TownData, NormalizedOptions, Vertex, Wall, Gate, Building, Feature, Road } from './types.js';
export const GENERATOR_VERSION = '0.7.0';
export function exportTown(model: Model, request: NormalizedOptions, attempts: number): TownData {
  const vertices: Vertex[] = [], ids = new Map<Point, string>();
  const vertex = (p: Point): string => {
    let id = ids.get(p);
    if (id === undefined) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new RetryableError('Non-finite generated coordinate');
      id = `v${vertices.length}`; ids.set(p, id); vertices.push({ id, x: p.x, y: p.y });
    } return id;
  };
  const ring = (shape: Polygon): string[] => {
    if (shape.length < 3 || !Number.isFinite(shape.square) || shape.square <= 0 || new Set(shape).size !== shape.length) throw new RetryableError('Degenerate generated polygon');
    return Array.from(shape, vertex);
  };
  const districts = model.patches.map((p, i) => ({ id: `d${i}`, boundary: ring(p.shape), wardType: p.ward!.type, withinCity: p.withinCity, withinWalls: p.withinWalls }));
  const buildings: Building[] = [], features: Feature[] = [];
  for (let i = 0; i < model.patches.length; i++) {
    const ward = model.patches[i].ward!;
    for (const shape of ward.geometry) {
      if (!containsPolygon(model.patches[i].shape, shape)) throw new RetryableError('Generated geometry outside its district');
      const boundary = ring(shape), districtId = districts[i].id;
      if (ward.featureKind) features.push({ id: `f${features.length}`, districtId, kind: ward.featureKind, boundary });
      else buildings.push({ id: `b${buildings.length}`, districtId, boundary });
    }
  }
  const roads: Road[] = [];
  for (const [kind, paths] of [['street', model.streets], ['external', model.roads]] as const) {
    for (const path of paths) if (path.length > 1) roads.push({ id: `r${roads.length}`, kind, vertexIds: Array.from(path, vertex), width: 2 });
  }
  const walls: Wall[] = [], gates: Gate[] = [];
  function wall(value: CurtainWall, kind: 'city' | 'castle'): void {
    const id = `w${walls.length}`, gateIds: string[] = [];
    for (const p of value.gates) { const gid = `g${gates.length}`; gates.push({ id: gid, wallId: id, vertexId: vertex(p) }); gateIds.push(gid); }
    walls.push({ id, kind, boundary: ring(value.shape), activeSegments: [...value.segments], gateIds, towerVertexIds: value.towers.map(vertex) });
  }
  if (model.wall) wall(model.wall, 'city');
  if (model.citadel?.ward?.wall) wall(model.citadel.ward.wall, 'castle');
  const entrances = model.gates.map(vertex);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of vertices) { minX = Math.min(minX, v.x); minY = Math.min(minY, v.y); maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y); }
  return {
    schemaVersion: '1', generatorVersion: GENERATOR_VERSION, request: { ...request },
    resolved: { seed: request.seed, size: request.size, ...model.features, attempts },
    vertices, districts, buildings, features, roads, walls, gates, entrances,
    center: { x: model.center.x, y: model.center.y }, bounds: { minX, minY, maxX, maxY },
  };
}
