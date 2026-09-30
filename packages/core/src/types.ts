export type FeatureChoice = boolean | 'auto';
export type CoastSide = 'east' | 'south' | 'west' | 'north';
export interface GenerateOptions {
  seed: number; size: number;
  walls?: FeatureChoice; castle?: FeatureChoice; plaza?: FeatureChoice;
  maxAttempts?: number;
  river?: boolean;
  coast?: CoastSide | 'auto' | false;
  harbor?: boolean;
}
export type NormalizedOptions = Required<Omit<GenerateOptions, 'river' | 'coast' | 'harbor'>> & Pick<GenerateOptions, 'river' | 'coast' | 'harbor'>;
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
export interface Bridge { id: Id; roadId: Id; points: Point2[]; width: number }
export interface River { centerline: Point2[]; width: number; bankWidth: number; bridges: Bridge[]; surface?: Point2[] }
export interface Coast { side: CoastSide; shoreline: Point2[]; water: Point2[] }
export interface Dock { id: Id; districtId: Id; roadId: Id; points: Point2[]; width: number }
export interface Terrain { coast?: Coast; waterfronts: { roadId: Id; kind: 'coast' | 'river' }[]; docks: Dock[] }
export interface NamedRegion { id: Id; name: string; kind: 'quarter' | 'harbor' | 'citadel'; districtIds: Id[] }
export interface TownAtlas { version: '1'; cityName: string; regions: NamedRegion[] }
export interface TownData {
  schemaVersion: '1'; generatorVersion: string; request: NormalizedOptions;
  resolved: { seed: number; size: number; walls: boolean; castle: boolean; plaza: boolean; attempts: number };
  vertices: Vertex[]; districts: District[]; buildings: Building[]; features: Feature[];
  roads: Road[]; walls: Wall[]; gates: Gate[]; entrances: Id[];
  center: Point2; bounds: Bounds;
  river?: River;
  terrain?: Terrain;
  atlas?: TownAtlas;
}
