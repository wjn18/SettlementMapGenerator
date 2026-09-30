import { Random, RetryableError } from './context.js';
import { Point, Polygon, containsPolygon } from './geometry.js';
import { Model, Patch } from './model.js';
import { SkeletonModel } from './skeleton.js';
import { GraphNode, shortestPath } from './pathfinding.js';
import { createWard } from './wards.js';
import { rebuildCityFortifications } from './fortifications.js';
import { exportTown } from './export.js';
import { distanceToPath } from './river.js';
import { inRing, mixPoint, pointKey, positiveRing, splitSegment, subtractRing } from './terrain-geometry.js';
import type { Coast, CoastSide, NormalizedOptions, Point2, River, TownData } from './types.js';

interface Plan {
  radius: number; extent: number; coast?: Coast; river?: River;
  cuts: Point2[][]; coastCut?: Point2[]; riverCut?: Point2[];
  local(p: Point2): Point; world(p: Point2): Point;
}
interface ShoreEdge { path: Polygon; patch: Patch; kind: 'coast' | 'river' }
export const TERRAIN_GENERATOR_VERSION = '0.10.0';
const wet = (p: Point2, plan: Plan): boolean => plan.cuts.some(ring => inRing(ring, p));
const touches = (shape: Polygon, cuts: Point2[][]): boolean => cuts.some(cut => {
  if (shape.some(p => inRing(cut, p)) || cut.some(p => inRing(shape, p))) return true;
  return shape.some((p, i) => splitSegment(p, shape[(i + 1) % shape.length], [cut]).length > 2);
});

/** Plan water before streets, ward assignment or building subdivision. All
 * later topology is constructed from the clipped, shared land boundaries. */
function planWater(model: Model, request: NormalizedOptions): Plan {
  const radius = model instanceof SkeletonModel ? model.planningRadius : Math.max(...model.inner.flatMap(p => p.shape.map(v => v.length)));
  const extent = radius * 4.5, random = new Random((request.seed % 2147483645) + 1);
  let side: CoastSide = request.coast && request.coast !== 'auto' ? request.coast : 'east';
  if (request.coast === 'auto' && model.citadel) {
    const p = model.citadel.shape.center;
    side = Math.abs(p.x) > Math.abs(p.y) ? (p.x > 0 ? 'west' : 'east') : (p.y > 0 ? 'north' : 'south');
  }
  const angle = ({ east: 0, south: 1, west: 2, north: 3 }[side]) * Math.PI / 2;
  const rotate = (p: Point2, a: number) => new Point(p.x * Math.cos(a) - p.y * Math.sin(a), p.x * Math.sin(a) + p.y * Math.cos(a));
  const world = (p: Point2) => rotate(p, angle), local = (p: Point2) => rotate(p, -angle);
  const phase = random.float() * Math.PI * 2;
  const coastX = (y: number) => radius * (0.57 + 0.13 * Math.sin(y / radius * 1.8 + phase));
  const plan: Plan = { radius, extent, local, world, cuts: [] };
  if (request.coast) {
    const line = Array.from({ length: 97 }, (_, i) => { const y = -extent + i * extent * 2 / 96; return new Point(coastX(y), y); });
    plan.coast = { side, shoreline: line.map(world), water: positiveRing([...line, new Point(extent, extent), new Point(extent, -extent)].map(world)) };
    plan.coastCut = positiveRing([...line.map(p => new Point(p.x - 2.8, p.y)), new Point(extent, extent), new Point(extent, -extent)].map(world));
    plan.cuts.push(plan.coastCut);
  }
  if (request.river) {
    const width = Math.max(5, Math.min(16, radius * 0.105)), bankWidth = 2.8;
    let best = Infinity, selected: River | undefined, selectedCut: Point2[] = [];
    for (const offset of [-0.32, 0.32, -0.48, 0.48, -0.15, 0.15]) {
      const riverY = (x: number) => radius * (offset + 0.12 * Math.sin(x / radius * 1.7 + phase));
      let mouth = radius * 0.57;
      for (let i = 0; i < 8; i++) mouth = coastX(riverY(mouth));
      const end = request.coast ? mouth + radius * 0.22 : extent;
      const upper: Point[] = [], lower: Point[] = [], bankUpper: Point[] = [], bankLower: Point[] = [], centerline: Point[] = [];
      for (let i = 0; i <= 96; i++) {
        const x = -extent + (end + extent) * i / 96, y = riverY(x);
        const halfWidth = width / 2 * (1 + 0.13 * Math.sin(x / radius + phase)) + (request.coast ? radius * 0.075 * Math.exp(-Math.pow((x - mouth) / (radius * 0.3), 2)) : 0);
        centerline.push(world(new Point(x, y)));
        upper.push(world(new Point(x, y - halfWidth))); lower.push(world(new Point(x, y + halfWidth)));
        bankUpper.push(world(new Point(x, y - halfWidth - bankWidth))); bankLower.push(world(new Point(x, y + halfWidth + bankWidth)));
      }
      const surface = positiveRing([...upper, ...lower.reverse()]), cut = positiveRing([...bankUpper, ...bankLower.reverse()]);
      const protectedHits = [model.plaza, model.citadel].filter(p => p && touches(p.shape, [cut])).length;
      const score = protectedHits * 1000 + Math.abs(offset) * 10;
      if (score < best) { best = score; selected = { centerline, width, bankWidth, surface, bridges: [] }; selectedCut = cut; }
    }
    plan.river = selected!; plan.riverCut = selectedCut; plan.cuts.push(selectedCut);
  }
  return plan;
}

function reserveLandmarks(model: Model, plan: Plan): void {
  if (model.citadel && touches(model.citadel.shape, plan.cuts)) {
    const candidates = model.patches.filter(p => !model.inner.includes(p) && !touches(p.shape, plan.cuts) && p.shape.compactness >= 0.75 && model.inner.some(n => p.shape.borders(n.shape)));
    candidates.sort((a, b) => a.shape.center.length - b.shape.center.length);
    if (!candidates.length) throw new RetryableError('No dry castle site');
    model.citadel.withinCity = false; model.citadel = candidates[0]; model.citadel.withinCity = true;
  }
  if (model.plaza && touches(model.plaza.shape, plan.cuts)) {
    const candidates = model.inner.filter(p => !touches(p.shape, plan.cuts));
    candidates.sort((a, b) => a.shape.center.length - b.shape.center.length);
    if (!candidates.length) throw new RetryableError('No dry market site');
    model.plaza = candidates[0]; model.center = model.plaza.shape[0];
  }
}

function clipDistricts(model: Model, plan: Plan): void {
  const points = new Map<string, Point>();
  // Preserve gate/wall identity wherever a land vertex survives clipping.
  for (const patch of model.patches) for (const p of patch.shape) points.set(pointKey(p), p);
  const shared = (p: Point): Point => { const key = pointKey(p); if (!points.has(key)) points.set(key, p); return points.get(key)!; };
  const inner = new Set(model.inner), replacements = new Map<Patch, Patch[]>();
  for (const patch of model.patches) {
    model.context.step();
    if (!touches(patch.shape, plan.cuts)) { replacements.set(patch, [patch]); continue; }
    if (patch === model.citadel || patch === model.plaza) throw new RetryableError('Water intersects a reserved landmark');
    let rings = [patch.shape];
    for (const cut of plan.cuts) rings = rings.flatMap(ring => subtractRing(ring, cut));
    replacements.set(patch, rings.filter(ring => ring.square > 3).map(ring => {
      const p = new Patch(new Polygon(ring.map(shared)));
      p.withinCity = patch.withinCity; p.withinWalls = patch.withinWalls; return p;
    }));
  }
  model.patches = model.patches.flatMap(p => replacements.get(p)!);
  // buildWalls can prune distant patches; do not reintroduce missing districts
  // when a later attempt chooses a different castle site.
  model.inner = [...inner].flatMap(p => replacements.get(p) ?? []);
  const surviving = new Set(model.patches.flatMap(p => [...p.shape]));
  model.gates = model.gates.filter(p => surviving.has(p) && !wet(p, plan));
  model.border!.gates.splice(0, model.border!.gates.length, ...model.border!.gates.filter(p => model.gates.includes(p)));
  if (model.wall) model.wall.towers = model.wall.towers.filter(p => !wet(p, plan));
  if (!model.inner.length) throw new RetryableError('No buildable land');
  if (wet(model.center, plan)) model.center = [...model.inner].sort((a, b) => a.shape.center.length - b.shape.center.length)[0].shape[0];
}

function buildLandRoads(model: Model, plan: Plan): { shores: ShoreEdge[]; bridges: Polygon[] } {
  const shores: ShoreEdge[] = [], bridges: Polygon[] = [], edges = new Map<string, Polygon>();
  const nodes = new Map<Point, GraphNode>(), nodePoints = new Map<GraphNode, Point>();
  const node = (p: Point) => { if (!nodes.has(p)) { const n = new GraphNode(nodes.size); nodes.set(p, n); nodePoints.set(n, p); } return nodes.get(p)!; };
  const urbanNodes = new Map<Point, GraphNode>(), urbanPoints = new Map<GraphNode, Point>();
  const urbanNode = (p: Point) => { if (!urbanNodes.has(p)) { const n = new GraphNode(urbanNodes.size); urbanNodes.set(p, n); urbanPoints.set(n, p); } return urbanNodes.get(p)!; };
  const urbanLink = (a: Point, b: Point) => urbanNode(a).link(urbanNode(b), Point.distance(a, b));
  const guideNodes = new Map<Point, GraphNode>(), guidePoints = new Map<GraphNode, Point>();
  const guideNode = (p: Point) => { if (!guideNodes.has(p)) { const n = new GraphNode(guideNodes.size); guideNodes.set(p, n); guidePoints.set(n, p); } return guideNodes.get(p)!; };
  const link = (a: Point, b: Point) => {
    node(a).link(node(b), Point.distance(a, b));
    if (model instanceof SkeletonModel && model.guideWidth(a, b) > 2) guideNode(a).link(guideNode(b), Point.distance(a, b));
  };
  const key = (a: Point, b: Point) => [pointKey(a), pointKey(b)].sort().join('/');
  for (const patch of model.patches) patch.shape.forEdge((a, b) => {
    link(a, b);
    if (!patch.withinCity) return;
    urbanLink(a, b);
    const edgeKey = key(a, b);
    const mid = mixPoint(a, b, 0.5);
    const shoreline = plan.cuts.some(cut => distanceToPath(mid, [...cut, cut[0]]) < 0.001);
    if (model instanceof SkeletonModel && !shoreline && model.guideWidth(a, b) < 2 && !model.getNeighbour(patch, a)?.withinCity) return;
    if (!edges.has(edgeKey)) edges.set(edgeKey, new Polygon([a, b]));
    const path = edges.get(edgeKey)!;
    if (plan.coastCut && distanceToPath(mid, [...plan.coastCut, plan.coastCut[0]]) < 0.001) shores.push({ path, patch, kind: 'coast' });
    else if (plan.riverCut && distanceToPath(mid, [...plan.riverCut, plan.riverCut[0]]) < 0.001) shores.push({ path, patch, kind: 'river' });
  });
  if (plan.river) {
    const shorePaths = new Set(shores.map(s => s.path));
    const bankPoints = [...new Set(shores.filter(s => s.kind === 'river' && s.patch.shape.square > 60).flatMap(s => [...s.path]))].filter(p => [...edges.values()].some(path => path.includes(p) && !shorePaths.has(path)));
    const candidates: { path: Polygon; x: number; length: number }[] = [];
    for (let i = 0; i < bankPoints.length; i++) for (let j = i + 1; j < bankPoints.length; j++) {
      model.context.step();
      const a = bankPoints[i], b = bankPoints[j], la = plan.local(a), lb = plan.local(b), length = Point.distance(a, b);
      if (Math.abs(la.x - lb.x) > plan.radius * 0.32 || length > plan.river.width * 4 + 12 || length < plan.river.width) continue;
      const samples = Array.from({ length: 19 }, (_, k) => mixPoint(a, b, (k + 1) / 20));
      if (!samples.every(p => inRing(plan.riverCut!, p) && (!plan.coastCut || !inRing(plan.coastCut, p))) || !samples.some(p => inRing(plan.river!.surface!, p))) continue;
      candidates.push({ path: new Polygon([a, b]), x: (la.x + lb.x) / 2, length });
    }
    candidates.sort((a, b) => (a.length + Math.abs(a.x) * 0.12) - (b.length + Math.abs(b.x) * 0.12));
    const selected: typeof candidates = [];
    for (const candidate of candidates) {
      if (selected.some(other => Math.abs(other.x - candidate.x) < plan.radius * 0.65)) continue;
      selected.push(candidate); bridges.push(candidate.path); link(candidate.path[0], candidate.path[1]); urbanLink(candidate.path[0], candidate.path[1]);
      edges.set(key(candidate.path[0], candidate.path[1]), candidate.path);
      if (selected.length >= Math.max(1, Math.ceil(model.size / 18))) break;
    }
    if (!bridges.length) throw new RetryableError('No safe crossing between the inhabited riverbanks');
  }
  if (model instanceof SkeletonModel) {
    // Omit unused perimeter streets, but keep all actual street fragments
    // connected. Add only the missing land-boundary links between components.
    for (;;) {
      model.context.step();
      const adjacency = new Map<Point, Point[]>();
      for (const path of edges.values()) for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        if (!adjacency.has(a)) adjacency.set(a, []); if (!adjacency.has(b)) adjacency.set(b, []);
        adjacency.get(a)!.push(b); adjacency.get(b)!.push(a);
      }
      const seen = new Set<Point>(), groups: Point[][] = [];
      for (const first of adjacency.keys()) if (!seen.has(first)) {
        const group: Point[] = [], queue = [first];
        while (queue.length) { const p = queue.pop()!; if (seen.has(p)) continue; seen.add(p); group.push(p); queue.push(...adjacency.get(p)!); }
        groups.push(group);
      }
      if (groups.length < 2) break;
      groups.sort((a, b) => b.length - a.length);
      let pair: [Point, Point] | undefined, distance = Infinity;
      for (const a of groups[0]) for (const b of groups[1]) if (Point.distance(a, b) < distance) { pair = [a, b]; distance = Point.distance(a, b); }
      const path = shortestPath(urbanNode(pair![0]), urbanNode(pair![1]), []);
      if (!path) throw new RetryableError('No inhabited land connection between street fragments');
      const points = path.map(n => urbanPoints.get(n)!);
      for (let i = 1; i < points.length; i++) {
        const edgeKey = key(points[i - 1], points[i]);
        if (!edges.has(edgeKey)) edges.set(edgeKey, new Polygon([points[i - 1], points[i]]));
      }
    }
  }
  model.streets = [...edges.values()]; model.arteries = [...model.streets]; model.roads = [];
  model.roadWidths.clear();
  if (model instanceof SkeletonModel) for (const path of model.streets) {
    const shore = shores.some(s => s.path === path), bridgeJunction = bridges.some(b => path.some(p => b.includes(p)));
    model.roadWidths.set(path, Math.max(model.guideWidth(path[0], path[1]), bridges.includes(path) || (shore && bridgeJunction) ? 3.8 : shore ? 2.6 : 1.4));
  }
  // Routes to the countryside use the dry-land graph, with bridge edges already present.
  const cityPoints = new Set(model.patches.filter(p => p.withinCity).flatMap(p => [...p.shape]));
  const blocked = [...(model.wall?.shape ?? []), ...(model.citadel?.shape ?? [])].filter(p => !model.gates.includes(p) && nodes.has(p)).map(node);
  const starts = model.border!.gates.filter(p => nodes.has(p));
  for (const start of starts.slice(0, model.plannedLayout ? starts.length : 5)) {
    const direction = start.subtract(model.center).norm(1);
    let candidates = [...nodes.keys()].filter(p => !cityPoints.has(p));
    if (model instanceof SkeletonModel) {
      const on = (p: Point, a: Point, b: Point) => {
        const d = b.subtract(a), t = p.subtract(a).dot(d) / d.dot(d);
        return t >= -1e-7 && t <= 1 + 1e-7 && Point.distance(p, a.add(d.scale(t))) < 1e-5;
      };
      const routes = model.guides.filter(g => g.path.slice(1).some((b, i) => on(start, g.path[i], b)));
      candidates = candidates.filter(p => routes.some(g => g.path.slice(1).some((b, i) => on(p, g.path[i], b))));
    }
    candidates.sort((a, b) => b.dot(direction) - a.dot(direction));
    for (const end of candidates.slice(0, 12)) {
      if (model instanceof SkeletonModel) {
        if (!guideNodes.has(start) || !guideNodes.has(end)) continue;
        const forbidden = [...cityPoints].filter(p => p !== start && guideNodes.has(p)).map(p => guideNodes.get(p)!);
        const path = shortestPath(guideNodes.get(start)!, guideNodes.get(end)!, forbidden);
        if (path) { const route = new Polygon(path.reverse().map(n => guidePoints.get(n)!)); model.roads.push(route); model.roadWidths.set(route, 3.8); break; }
      } else {
        const path = shortestPath(node(start), node(end), blocked);
        if (path) { model.roads.push(new Polygon(path.reverse().map(n => nodePoints.get(n)!))); break; }
      }
    }
  }
  // Every inhabited land component must be reachable from the same road network.
  const start = node(model.inner[0].shape[0]), visited = new Set<GraphNode>(), queue = [start];
  while (queue.length) { const n = queue.pop()!; if (visited.has(n)) continue; visited.add(n); queue.push(...n.links.keys()); }
  if ([...cityPoints].some(p => !visited.has(node(p)))) throw new RetryableError('Disconnected waterfront district');
  return { shores, bridges };
}

function trimWalls(town: TownData, plan: Plan): void {
  const index = new Map(town.vertices.map(v => [v.id, v]));
  const add = (p: Point2) => { const id = `v${town.vertices.length}`; town.vertices.push({ id, x: p.x, y: p.y }); return id; };
  for (const wall of town.walls) {
    const original = [...wall.boundary], boundary: string[] = [], active: boolean[] = [];
    for (let i = 0; i < original.length; i++) {
      const a = index.get(original[i])!, b = index.get(original[(i + 1) % original.length])!;
      const parts = splitSegment(a, b, plan.cuts);
      for (let j = 1; j < parts.length; j++) {
        boundary.push(j === 1 ? original[i] : add(parts[j - 1]));
        active.push(wall.activeSegments[i] && !wet(mixPoint(parts[j - 1], parts[j], 0.5), plan));
      }
    }
    wall.boundary = boundary; wall.activeSegments = active;
    wall.towerVertexIds = wall.towerVertexIds.filter(id => !wet(index.get(id)!, plan));
    wall.gateIds = wall.gateIds.filter(id => !wet(index.get(town.gates.find(g => g.id === id)!.vertexId)!, plan));
  }
  const gates = new Set(town.walls.flatMap(w => w.gateIds));
  town.gates = town.gates.filter(g => gates.has(g.id));
  town.entrances = town.entrances.filter(id => !wet(index.get(id)!, plan));
}

export function* buildTerrainTown(model: Model, request: NormalizedOptions, attempts: number): Generator<string, TownData, void> {
  for (const stage of ['buildPatches', 'optimizeJunctions'] as const) { model.context.stage = stage; model[stage](); yield stage; }
  model.context.stage = 'terrain'; const plan = planWater(model, request); yield 'terrain';
  if (model instanceof SkeletonModel) {
    model.context.stage = 'planRoadSkeleton'; yield 'planRoadSkeleton';
    model.context.stage = 'subdivideDistricts'; model.subdivideDistricts(plan.cuts); yield 'subdivideDistricts';
  }
  reserveLandmarks(model, plan);
  // The wall follows the older developed core, with younger frontage outside it.
  model.context.stage = 'buildWalls'; model.buildWalls(); clipDistricts(model, plan);
  if (model instanceof SkeletonModel) model.fitLandDistricts();
  yield 'buildWalls';
  model.context.stage = 'buildStreets'; const { shores, bridges } = buildLandRoads(model, plan); yield 'buildStreets';
  model.context.stage = 'createWards'; model.createWards();
  if (plan.coast && request.harbor !== false) for (const { patch, kind } of shores) {
    if (kind === 'coast' && patch !== model.citadel && patch !== model.plaza) patch.ward = createWard('Harbor', model, patch);
  }
  yield 'createWards'; model.context.stage = 'buildGeometry';
  if (model.plannedLayout) model.buildGeometry();
  else for (const patch of model.patches) {
    model.context.step();
    if (patch.shape.square < 8) continue;
    patch.ward!.createGeometry();
    // Ward subdivision can overhang acute/concave corners. Keep complete, dry footprints.
    patch.ward!.geometry = patch.ward!.geometry.filter(p => p.square > 0.05 && containsPolygon(patch.shape, p));
  }
  yield 'buildGeometry'; model.context.stage = 'export';
  const town = exportTown(model, request, attempts);
  town.generatorVersion = TERRAIN_GENERATOR_VERSION;
  if (!request.river && !request.coast) { rebuildCityFortifications(town); return town; }
  const plain = (p: Point2): Point2 => ({ x: p.x, y: p.y });
  town.terrain = { ...(plan.coast ? { coast: { ...plan.coast, shoreline: plan.coast.shoreline.map(plain), water: plan.coast.water.map(plain) } } : {}), waterfronts: [], docks: [] };
  const index = new Map(town.vertices.map(v => [v.id, v]));
  const roadFor = (path: Polygon) => town.roads.find(r => r.kind === 'street' && r.vertexIds.length === path.length && r.vertexIds.every((id, i) => pointKey(index.get(id)!) === pointKey(path[i])))!;
  for (const shore of shores) {
    const road = roadFor(shore.path); road.width = Math.max(road.width, 2.6);
    if (!town.terrain.waterfronts.some(w => w.roadId === road.id)) town.terrain.waterfronts.push({ roadId: road.id, kind: shore.kind });
  }
  if (plan.river) {
    town.river = { ...plan.river, centerline: plan.river.centerline.map(plain), surface: plan.river.surface!.map(plain), bridges: [] };
    for (const path of bridges) {
      const road = roadFor(path); road.width = Math.max(road.width, 3);
      town.river.bridges.push({ id: `bridge${town.river.bridges.length}`, roadId: road.id, points: path.map(p => ({ x: p.x, y: p.y })), width: road.width + 0.5 });
    }
  }
  if (plan.coast && request.harbor !== false) {
    const placed: Point2[] = [];
    for (const shore of shores.filter(s => s.kind === 'coast' && s.patch.ward?.type === 'Harbor')) {
      const [a, b] = shore.path, length = Point.distance(a, b), road = roadFor(shore.path);
      const count = length < 0.8 ? 0 : Math.max(1, Math.floor(length / 12));
      for (let i = 0; i < count; i++) {
        const start = mixPoint(a, b, (i + 0.5) / count);
        if (placed.some(p => Math.hypot(p.x - start.x, p.y - start.y) < 10)) continue;
        const tangent = b.subtract(a).norm(), normal = new Point(tangent.y, -tangent.x);
        if (!inRing(plan.coast.water, start.add(normal.scale(5)))) normal.scaleEq(-1);
        const end = start.add(normal.scale(9 + (town.terrain.docks.length % 3) * 2));
        if (!inRing(plan.coast.water, end) || (plan.riverCut && Array.from({ length: 9 }, (_, k) => mixPoint(start, end, k / 8)).some(p => inRing(plan.riverCut!, p)))) continue;
        placed.push(start);
        town.terrain.docks.push({ id: `dock${town.terrain.docks.length}`, districtId: town.districts[model.patches.indexOf(shore.patch)].id, roadId: road.id, points: [start, end].map(p => ({ x: p.x, y: p.y })), width: 1.5 });
      }
    }
    if (!town.terrain.docks.length) throw new RetryableError('No accessible harbor frontage');
  }
  trimWalls(town, plan);
  rebuildCityFortifications(town, plan.cuts);
  // Include water extents in world bounds, keeping exact bounds validation and exports.
  for (const p of [...(plan.coast?.water ?? []), ...(plan.river?.surface ?? [])]) town.vertices.push({ id: `v${town.vertices.length}`, x: p.x, y: p.y });
  town.bounds = { minX: Math.min(...town.vertices.map(v => v.x)), minY: Math.min(...town.vertices.map(v => v.y)), maxX: Math.max(...town.vertices.map(v => v.x)), maxY: Math.max(...town.vertices.map(v => v.y)) };
  return town;
}
