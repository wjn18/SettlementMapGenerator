export type FeatureChoice = boolean | 'auto';
export interface GenerateOptions {
  seed: number; size: number;
  walls?: FeatureChoice; castle?: FeatureChoice; plaza?: FeatureChoice;
  maxAttempts?: number;
}
export type NormalizedOptions = Required<GenerateOptions>;
export interface GenerationError {
  code: 'INVALID_OPTIONS' | 'GENERATION_FAILED' | 'RESOURCE_LIMIT';
  stage: string; message: string; attempts: number;
}
export type GenerationResult = { ok: true; town: TownData } | { ok: false; error: GenerationError };
export interface GenerationProgress { attempt: number; stage: string }
export type Id = string;
export type PolygonRing = Id[];
export interface Point2 { x: number; y: number }
export interface Vertex extends Point2 { id: Id }
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export interface District { id: Id; boundary: PolygonRing; wardType: string; withinCity: boolean; withinWalls: boolean }
export interface Building { id: Id; districtId: Id; boundary: PolygonRing }
export interface Feature extends Building { kind: 'grove' | 'statue' | 'fountain' }
export interface Road { id: Id; kind: 'street' | 'external'; vertexIds: Id[]; width: number }
export interface Wall { id: Id; kind: 'city' | 'castle'; boundary: PolygonRing; activeSegments: boolean[]; gateIds: Id[]; towerVertexIds: Id[] }
export interface Gate { id: Id; wallId: Id; vertexId: Id }
export interface TownData {
  schemaVersion: '1'; generatorVersion: string; request: NormalizedOptions;
  resolved: { seed: number; size: number; walls: boolean; castle: boolean; plaza: boolean; attempts: number };
  vertices: Vertex[]; districts: District[]; buildings: Building[]; features: Feature[];
  roads: Road[]; walls: Wall[]; gates: Gate[]; entrances: Id[];
  center: Point2; bounds: Bounds;
}
