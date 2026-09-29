// Test-only adapter for the independent P1 Haxe observer format.
export function snapshot(stage, model) {
  const points = [], vertices = [];
  function vertex(p) {
    let id = points.indexOf(p);
    if (id < 0) { id = points.length; points.push(p); vertices.push({ id, x: p.x, y: p.y }); }
    return id;
  }
  const ring = shape => shape ? Array.from(shape, vertex) : [];
  const wall = w => w ? { boundary: ring(w.shape), segments: [...w.segments], gates: ring(w.gates), towers: ring(w.towers) } : null;
  const patches = model.patches.map((p, id) => ({
    id, boundary: ring(p.shape), withinCity: p.withinCity, withinWalls: p.withinWalls,
    ward: p.ward ? `com.watabou.towngenerator.wards.${p.ward.type}` : null,
    geometry: p.ward ? p.ward.geometry.map(ring) : [],
  }));
  return {
    stage, randomState: model.context.random.state, features: model.features, vertices, patches,
    inner: model.inner.map(p => model.patches.indexOf(p)), plaza: model.patches.indexOf(model.plaza), citadel: model.patches.indexOf(model.citadel),
    center: vertex(model.center), streets: model.streets.map(ring), roads: model.roads.map(ring), arteries: model.arteries.map(ring),
    border: wall(model.border), wall: wall(model.wall), castleWall: wall(model.citadel?.ward?.wall), gates: ring(model.gates),
  };
}
