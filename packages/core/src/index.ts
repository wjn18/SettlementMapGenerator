export { generateTown, generateTownSteps } from './generator.js';
export { GENERATOR_VERSION } from './export.js';
export { TERRAIN_GENERATOR_VERSION } from './terrain.js';
export { createTownAtlas, getTownAtlas, renameTown, normalizeMapName } from './names.js';
export type { NamedRegion, TownAtlas } from './types.js';
export { distanceToPath, polygonTouchesRiver } from './river.js';
export type { River, Bridge, Coast, CoastSide, Terrain, Dock } from './types.js';
export { serializeTown, deserializeTown, validateTown, TownDataError, hasVertexId, containsPoint, createVertexIndex } from './serialization.js';
export type { GenerateOptions, NormalizedOptions, FeatureChoice, GenerationResult, GenerationError, GenerationProgress, TownData, Id, PolygonRing, Point2, Vertex, District, Building, Feature, Road, Wall, Gate, Bounds } from './types.js';
