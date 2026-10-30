"""Verify an inland river from the saved meshes and untouched source plan.

No derived land or bridge polygon from the assembler is trusted as evidence.
The source surface, bridge paths and road widths define the XY requirements.
"""
import math

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from footprint_geometry import compare_footprints, signed_area
from planar_coverage import planar_coverage


WATER_Z = -1.15
ROAD_Z = .035
BED_Z = -2.0


def xy(raw):
    return [(p['x'], p['y']) if isinstance(p, dict) else tuple(p[:2]) for p in raw]


def bounds(poly):
    return (min(p[0] for p in poly), max(p[0] for p in poly),
            min(p[1] for p in poly), max(p[1] for p in poly))


def boxes_overlap(a, b, margin=0):
    return a[0] <= b[1]+margin and b[0] <= a[1]+margin and a[2] <= b[3]+margin and b[2] <= a[3]+margin


def convex_intersection(subject, clip):
    """Double precision clipping, used only by the independent verifier."""
    output = list(subject)
    if signed_area(clip) < 0:
        clip = list(reversed(clip))
    for a, b in zip(clip, clip[1:]+clip[:1]):
        if not output:
            break
        incoming, output = output, []
        for p, q in zip(incoming, incoming[1:]+incoming[:1]):
            dp = (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
            dq = (b[0]-a[0])*(q[1]-a[1])-(b[1]-a[1])*(q[0]-a[0])
            ip, iq = dp >= 0, dq >= 0
            if ip:
                output.append(p)
            if ip != iq:
                t = dp/(dp-dq)
                output.append((p[0]+t*(q[0]-p[0]), p[1]+t*(q[1]-p[1])))
    return output


def overlap_area(triangle, source_triangles):
    bb = bounds(triangle)
    result = 0.0
    for other, ob in source_triangles:
        if not boxes_overlap(bb, ob):
            continue
        clipped = convex_intersection(triangle, other)
        if len(clipped) >= 3:
            result += abs(signed_area(clipped))
    return result


def boundary_loops(obj):
    counts = {}
    for face in obj.data.polygons:
        indices = list(face.vertices)
        for a, b in zip(indices, indices[1:]+indices[:1]):
            key = tuple(sorted((a, b)))
            counts[key] = counts.get(key, 0)+1
    adjacency = {}
    for (a, b), count in counts.items():
        if count == 1:
            adjacency.setdefault(a, []).append(b)
            adjacency.setdefault(b, []).append(a)
    if not adjacency or any(len(v) != 2 for v in adjacency.values()):
        return []
    remaining, loops = set(adjacency), []
    while remaining:
        first = min(remaining)
        loop, previous, current = [], None, first
        for _ in range(len(adjacency)+1):
            loop.append(current)
            remaining.discard(current)
            following = next(v for v in adjacency[current] if v != previous)
            previous, current = current, following
            if current == first:
                break
        else:
            return []
        loops.append(loop)
    return loops


def path_samples(path, width, step=1.5, lateral=(-.5, -.25, 0, .25, .5)):
    samples = []
    for a, b in zip(path, path[1:]):
        length = math.dist(a, b)
        if length < 1e-8:
            continue
        n = (-(b[1]-a[1])/length, (b[0]-a[0])/length)
        count = max(1, math.ceil(length/step))
        for i in range(count+1):
            p = (a[0]+(b[0]-a[0])*i/count, a[1]+(b[1]-a[1])*i/count)
            samples.extend((p[0]+n[0]*s*width, p[1]+n[1]*s*width) for s in lateral)
    return samples


def shell_closure(vertices, faces, water_boundary, tolerance):
    """Count actual geometric edge incidence, including collinear T splits.

    Consecutive closed bank wedges can touch on a vertical edge when the
    available shore width becomes zero. That contact has four incident faces;
    it is permitted only at the source water boundary. Bare bottom edges are
    still required to have two incident faces.
    """
    epsilon = max(1e-7, tolerance*.01)
    def key(point):
        return tuple(round(float(v), 8) for v in point)
    valid_faces = []
    for face in faces:
        ps = [vertices[i] for i in face]
        if len(ps) < 3:
            continue
        # Ignore genuinely zero-area cross sections at collapsed shore width.
        face_area = sum((ps[i]-ps[0]).cross(ps[i+1]-ps[0]).length/2
                        for i in range(1, len(ps)-1))
        if face_area > epsilon*epsilon:
            valid_faces.append(ps)
    unique = {key(p): p for face in valid_faces for p in face}
    candidates = list(unique.values())
    incidences = {}
    for face in valid_faces:
        for a, b in zip(face, face[1:]+face[:1]):
            direction = b-a
            length2 = direction.length_squared
            if length2 <= epsilon*epsilon:
                continue
            split = [(0., a), (1., b)]
            lo = [min(a[i], b[i])-epsilon for i in range(3)]
            hi = [max(a[i], b[i])+epsilon for i in range(3)]
            for point in candidates:
                if not all(lo[i] <= point[i] <= hi[i] for i in range(3)):
                    continue
                t = (point-a).dot(direction)/length2
                if epsilon < t < 1-epsilon and (point-a-direction*t).length <= epsilon:
                    split.append((t, point))
            split.sort(key=lambda item: item[0])
            for (_, p), (_, q) in zip(split, split[1:]):
                if (q-p).length <= epsilon:
                    continue
                edge = tuple(sorted((key(p), key(q))))
                incidences[edge] = incidences.get(edge, 0)+1
    def on_water(point):
        x, y = point[:2]
        distances = []
        for a, b in zip(water_boundary, water_boundary[1:]+water_boundary[:1]):
            dx, dy = b[0]-a[0], b[1]-a[1]
            square = dx*dx+dy*dy
            t = max(0, min(1, ((x-a[0])*dx+(y-a[1])*dy)/square)) if square else 0
            distances.append(math.hypot(x-a[0]-t*dx, y-a[1]-t*dy))
        return min(distances, default=math.inf) <= tolerance
    open_edges, bad_edges, contacts = [], [], []
    for edge, count in incidences.items():
        if count == 2:
            continue
        a, b = edge
        vertical = math.hypot(a[0]-b[0], a[1]-b[1]) <= epsilon
        if count == 4 and vertical and on_water(a) and on_water(b):
            contacts.append({'edge': edge, 'incidentFaces': count})
        elif count == 1:
            open_edges.append({'edge': edge, 'incidentFaces': count})
        else:
            bad_edges.append({'edge': edge, 'incidentFaces': count})
    return {'passed': bool(incidences) and not open_edges and not bad_edges,
            'method': 'actual nondegenerate geometric edges split at collinear vertices',
            'nondegenerateFaces': len(valid_faces), 'geometricEdges': len(incidences),
            'openEdgeCount': len(open_edges), 'invalidEdgeCount': len(bad_edges),
            'zeroWidthContactCount': len(contacts), 'openEdges': open_edges[:20],
            'invalidEdges': bad_edges[:20], 'zeroWidthContacts': contacts[:20]}


def verify_river(selection, manifest, scale, source=None, tolerance=1e-4):
    river = (source or selection).get('river')
    # Infer required depth from the source ports, independently of the builder.
    bed_z = -3.6 if any(d.get('waterbody')=='river' for d in (source or selection).get('terrain',{}).get('docks',[])) else BED_Z
    data = manifest.get('river', {})
    if not river:
        passed = not data.get('enabled')
        return {'enabled': False, 'passed': passed, 'checks': [], 'bridges': [],
                'failures': [] if passed else ['A river was added without source river planning.']}
    failures, checks, bridge_results = [], [], []
    def check(value, message):
        if not value:
            failures.append(message)
        return bool(value)
    if not check(bool(river.get('surface')), 'The inland river requires its source surface polygon.'):
        return {'enabled': True, 'passed': False, 'checks': checks, 'bridges': [], 'failures': failures}
    coast = selection.get('terrain', {}).get('coast')
    estuary = bool(coast)
    if estuary:
        check(manifest.get('estuary', {}).get('enabled') and manifest['estuary'].get('version') == 1,
              'The river and sea have no current combined-water representation.')
    check(data.get('enabled') and data.get('version') in (1,2), 'The source river has no current three-dimensional representation.')
    check(abs(data.get('waterLevel', math.inf)-WATER_Z) < tolerance, 'The declared river water level is incorrect.')
    check(abs(data.get('roadTop', math.inf)-ROAD_Z) < tolerance, 'The declared bridge walking level is incorrect.')
    check(abs(data.get('bedLevel', math.inf)-bed_z) < tolerance, 'The declared river-bed level is incorrect.')
    objects = {o.name: o for o in bpy.context.scene.objects if o.type == 'MESH'}
    depsgraph = bpy.context.evaluated_depsgraph_get()
    cache = {}
    def geometry(obj):
        if obj.name not in cache:
            evaluated = obj.evaluated_get(depsgraph)
            evaluated.data.calc_loop_triangles()
            vertices = [evaluated.matrix_world@v.co for v in evaluated.data.vertices]
            triangles = [tuple(t.vertices) for t in evaluated.data.loop_triangles]
            cache[obj.name] = (vertices, triangles)
        return cache[obj.name]
    def top_triangles(obj, low=-math.inf, high=math.inf):
        vertices, triangles = geometry(obj)
        result = []
        for tri in triangles:
            p = [vertices[i] for i in tri]
            ring = [(v.x, v.y) for v in p]
            if min(v.z for v in p) >= low-tolerance and max(v.z for v in p) <= high+tolerance and signed_area(ring) > 1e-12:
                result.append(ring)
        return result
    water_plan = xy(river['surface'])
    water = [(x*scale, y*scale) for x, y in water_plan]
    area_expected = abs(signed_area(water))
    area_tolerance = max(1e-4, area_expected*1e-6)
    surface = objects.get('River_water_surface')
    source_vectors = [Vector((x, y, 0)) for x, y in water]
    from mathutils.geometry import tessellate_polygon
    # Blender 5.2 returns index triples; earlier versions return Vector triples.
    # The float32 form of this exact source avoids spending overlap tolerance
    # on the initial mesh-coordinate representation at shared bank edges.
    def source_point(item):
        point = source_vectors[item] if isinstance(item, int) else item
        return (point.x, point.y)
    source_triangles = [[source_point(p) for p in tri] for tri in tessellate_polygon([source_vectors])]
    source_triangles = [(tri, bounds(tri)) for tri in source_triangles]
    # The independent estuary verifier checks the clipped river, source-water
    # union and shared shoreline. Inland rivers retain the original strict
    # one-source-boundary requirement below.
    river_ports=any(d.get('waterbody')=='river' for d in selection.get('terrain',{}).get('docks',[]))
    if not estuary and river_ports and check(surface is not None, 'The planned river water surface is missing.'):
        from verify_port_water import river_hulls, verify_cut_river
        triangles=top_triangles(surface,WATER_Z,WATER_Z)
        result=verify_cut_river(water,source_triangles,triangles,river_hulls(objects),tolerance*scale)
        vertices,_=geometry(surface)
        result['heightPassed']=bool(vertices) and all(abs(p.z-WATER_Z)<tolerance for p in vertices)
        result['passed']=result['passed'] and result['heightPassed']
        check(result['passed'],'The river water differs from its source minus actual vessel hull sections.')
        checks.append(result)
    elif not estuary and check(surface is not None, 'The planned river water surface is missing.'):
        vertices, _ = geometry(surface)
        loops = boundary_loops(surface)
        boundary_ok = check(len(loops) == 1, 'River water must have one intact source boundary.')
        comparison = {'passed': False}
        if boundary_ok:
            actual = [(vertices[i].x/scale, vertices[i].y/scale) for i in loops[0]]
            comparison = compare_footprints(water_plan, actual, scale, tolerance)
        triangles = top_triangles(surface, WATER_Z, WATER_Z)
        actual_area = sum(abs(signed_area(t)) for t in triangles)
        height_ok = bool(vertices) and all(abs(v.z-WATER_Z) < tolerance for v in vertices)
        coverage_ok = abs(actual_area-area_expected) <= area_tolerance
        passed = comparison['passed'] and height_ok and coverage_ok
        check(passed, 'The actual river boundary, water coverage or level differs from the source river.')
        checks.append({'kind': 'river_water', 'passed': passed, 'boundary': comparison,
                       'heightPassed': height_ok, 'coveragePassed': coverage_ok,
                       'actualAreaSceneUnits2': actual_area, 'sourceAreaSceneUnits2': area_expected,
                       'areaToleranceSceneUnits2': area_tolerance})
    declared_land = list(data.get('landObjects', []))
    declared_banks = list(data.get('bankObjects', []))
    check(len(declared_land) >= 2 and len(set(declared_land)) == len(declared_land), 'The river must have two distinct dry-bank objects.')
    check(all(name in objects for name in declared_land+declared_banks), 'A declared river land or bank surface is missing.')
    actual_land = {o.name for o in objects.values() if o.get('source_terrain_role') == 'river_land'}
    actual_banks = {o.name for o in objects.values() if o.get('source_terrain_role') == 'river_bank'}
    check(actual_land == set(declared_land) and actual_banks == set(declared_banks), 'Actual river land or bank object IDs differ from the manifest.')
    for name in declared_land+declared_banks:
        obj = objects.get(name)
        if not obj:
            continue
        vertices, _ = geometry(obj)
        flat_top = top_triangles(obj, 0, 0)
        level_ok = bool(vertices) and abs(max(v.z for v in vertices)) < tolerance
        face_ok = bool(flat_top) if name in declared_land else bool(top_triangles(obj, WATER_Z-.061, 0))
        check(level_ok and face_ok, name+': river terrain has an incorrect top height or downward-facing walking bank.')
        if name in declared_banks:
            evaluated = obj.evaluated_get(depsgraph)
            closure = shell_closure(vertices, [tuple(f.vertices) for f in evaluated.data.polygons], water, tolerance*scale)
            check(closure['passed'], name+': river bank shell has open or non-manifold geometric edges.')
            checks.append({'kind': 'river_bank_shell', 'object': name, **closure})
    terrain = {o.name: o for o in objects.values() if o.name.startswith('River_land_') or o.name.startswith('River_bank_') or o.name == 'Study_ground'
               or o.get('source_terrain_role') in ('river_land', 'river_bank')}
    # Include unexpected floor geometry in the actual ground collection too.
    # This catches a residual rectangular slab even when it is not declared.
    ground_collection = bpy.data.collections.get('00_GROUND')
    bridge_road_ids = {b['roadId'] for b in river.get('bridges', [])}
    if ground_collection:
        for obj in ground_collection.all_objects:
            if obj.type != 'MESH' or obj.name == 'River_bed':
                continue
            if obj.name.startswith('Original_road_') and obj.name.removeprefix('Original_road_') in bridge_road_ids:
                continue
            terrain[obj.name] = obj
    overlap_rows = []
    projected_ground_area = 0.0
    for obj in terrain.values():
        triangles = top_triangles(obj, WATER_Z+tolerance*2, ROAD_Z+tolerance)
        overlap = sum(overlap_area(t, source_triangles) for t in triangles)
        allowance = max(1e-5, area_expected*1e-8)
        if overlap > allowance:
            overlap_rows.append({'object': obj.name, 'overlapAreaSceneUnits2': overlap})
        if obj.name in declared_land+declared_banks:
            projected_ground_area += sum(abs(signed_area(t)) for t in top_triangles(obj, -math.inf, tolerance))
    check(not overlap_rows, 'Dry land, shore paving or a non-bridge road covers the planned river.')
    crop = [(x*scale, y*scale) for x, y in xy(selection['cropPolygon'])]
    expected_dry_area = abs(signed_area(crop))-area_expected
    dry_area_tolerance = max(.002, abs(signed_area(crop))*1e-6)
    dry_coverage_ok = estuary or abs(projected_ground_area-expected_dry_area) <= dry_area_tolerance
    check(dry_coverage_ok, 'The actual dry banks and slopes do not cover the source crop minus river.')
    checks.append({'kind': 'river_land_separation', 'passed': not overlap_rows and dry_coverage_ok,
                   'overlaps': overlap_rows, 'actualDryAreaSceneUnits2': projected_ground_area,
                   'expectedDryAreaSceneUnits2': None if estuary else expected_dry_area,
                   'combinedCoverageCheckedBy': 'estuary' if estuary else None,
                   'areaToleranceSceneUnits2': dry_area_tolerance})
    bed = objects.get('River_bed')
    bed_triangles = top_triangles(bed, bed_z, bed_z) if bed else []
    centerline = [(x*scale, y*scale) for x, y in xy(river['centerline'])]
    if estuary:
        from harbor_geometry import inside
        sea = [(x*scale, y*scale) for x, y in xy(coast['water'])]
        centerline = [p for p in centerline if not inside(p, sea)]
    bed_coverage = planar_coverage(centerline, bed_triangles, tolerance*scale)
    check(bool(bed) and bed_coverage['passed'], 'The actual river bed is missing or does not underlie the source river.')
    checks.append({'kind': 'river_bed', 'passed': bool(bed) and bed_coverage['passed'], 'coverage': bed_coverage})
    roads = {r['id']: r for r in selection['roads']}
    expected_bridges = {b['id']: b for b in river.get('bridges', [])}
    declared_bridges = {b['id']: b for b in data.get('bridges', [])}
    check(bool(expected_bridges), 'The source inland river has no bridge.')
    check(set(expected_bridges) == set(declared_bridges) and len(declared_bridges) == len(data.get('bridges', [])), 'Manifest bridge IDs differ from the source river.')
    actual_bridge_ids = {o.get('source_bridge_id') for o in objects.values() if o.get('source_bridge_id')}
    check(actual_bridge_ids == set(expected_bridges), 'Actual bridge source IDs differ from the source river.')
    for bid, bridge in expected_bridges.items():
        if data.get('version',1)>=2:
            from verify_arch_bridge import verify_arch_bridge
            row=verify_arch_bridge(selection,bridge,declared_bridges.get(bid,{}),objects,scale,tolerance,bed_z)
            bridge_results.append(row);failures.extend(row['failures'])
            continue
        row_failures = len(failures)
        road = roads.get(bridge['roadId'])
        if not check(road is not None, bid+': bridge road is missing from the source selection.'):
            continue
        path = [(x*scale, y*scale) for x, y in xy(bridge['points'])]
        width = road['width']*scale
        outer_width = bridge['width']*scale
        check(outer_width >= width, bid+': bridge structure is narrower than the source road.')
        road_obj = objects.get('Original_road_'+bridge['roadId'])
        lane_triangles = top_triangles(road_obj, ROAD_Z, ROAD_Z) if road_obj else []
        coverage = planar_coverage(path_samples(path, width), lane_triangles, tolerance*scale)
        check(coverage['passed'], bid+': actual bridge walking surface does not cover the full source road path and width.')
        mounted = [o for o in objects.values() if o.get('source_bridge_id') == bid]
        decks = [o for o in mounted if o.get('asset_mount_role') == 'bridge_deck']
        supports = [o for o in mounted if o.get('asset_mount_role') == 'bridge_support']
        abutments = [o for o in mounted if o.get('asset_mount_role') == 'bridge_abutment']
        rails = [o for o in mounted if o.get('asset_mount_role') in ('bridge_rail', 'bridge_rail_end')]
        check(bool(decks) and bool(supports) and len(abutments) >= 2 and bool(rails), bid+': required timber deck, supports, two abutments or railings are missing.')
        deck_triangles = [t for o in decks for t in top_triangles(o, ROAD_Z-.08, ROAD_Z+tolerance)]
        deck_coverage = planar_coverage(path_samples(path, outer_width), deck_triangles, tolerance*scale)
        check(deck_coverage['passed'], bid+': timber deck does not cover the planned structural bridge width.')
        abutment_results = []
        deck_regions = [(triangle, bounds(triangle)) for triangle in deck_triangles]
        actual_abutments = []
        for obj in abutments:
            vertices, _ = geometry(obj)
            top_z = max(v.z for v in vertices)
            bearing_triangles = top_triangles(obj, top_z, top_z)
            overlap = sum(overlap_area(triangle, deck_regions) for triangle in bearing_triangles)
            overlap_minimum = max(1e-5, outer_width*tolerance*scale*4)
            grounded = min(v.z for v in vertices) <= bed_z+tolerance
            below = top_z <= ROAD_Z+tolerance
            carries_deck = overlap > overlap_minimum
            actual_abutments.append((obj, bearing_triangles, grounded and below and carries_deck))
            check(grounded and below and carries_deck, bid+': an abutment bearing does not overlap the actual timber deck, reach the bed or stay below the road.')
            abutment_results.append({'object': obj.name, 'passed': grounded and below and carries_deck,
                                     'actualDeckOverlapAreaSceneUnits2': overlap,
                                     'minimumBearingAreaSceneUnits2': overlap_minimum,
                                     'minZ': min(v.z for v in vertices), 'topZ': top_z})
        for endpoint in (path[0], path[-1]):
            seated = [obj.name for obj, triangles, valid in actual_abutments
                      if valid and planar_coverage([endpoint], triangles, tolerance*scale)['passed']]
            check(bool(seated), bid+': a source endpoint has no actual abutment bearing beneath it.')
        support_results = []
        for obj in supports:
            vertices, _ = geometry(obj)
            rooted = min(v.z for v in vertices) <= bed_z+tolerance
            below = max(v.z for v in vertices) <= ROAD_Z+tolerance
            check(rooted and below, bid+': a support is floating above the bed or projects through the walking surface.')
            support_results.append({'object': obj.name, 'passed': rooted and below,
                                    'minZ': min(v.z for v in vertices), 'maxZ': max(v.z for v in vertices)})
        blockers = []
        corridor = bounds(path_samples(path, width, lateral=(-.5, .5)))
        clearance_samples = path_samples(path, width, step=1.0, lateral=(-.48, -.25, 0, .25, .48))
        for obj in objects.values():
            if obj == road_obj or obj in decks:
                continue
            bb = [obj.matrix_world@Vector(p) for p in obj.bound_box]
            if max(v.z for v in bb) <= ROAD_Z+.005 or min(v.z for v in bb) >= ROAD_Z+2.1:
                continue
            if not boxes_overlap(corridor, bounds([(p.x, p.y) for p in bb]), tolerance):
                continue
            vertices, triangles = geometry(obj)
            if not triangles:
                continue
            tree = BVHTree.FromPolygons(vertices, triangles, all_triangles=True)
            hits = []
            for x, y in clearance_samples:
                hit = tree.ray_cast(Vector((x, y, ROAD_Z+.005)), Vector((0, 0, 1)), 2.095)[0]
                if hit is not None:
                    hits.append(tuple(hit))
            if hits:
                blockers.append({'object': obj.name, 'hitCount': len(hits), 'samples': hits[:5]})
        check(not blockers, bid+': an actual railing, abutment, wall or prop blocks the bridge walking clearance.')
        neighbors = []
        for endpoint_id, endpoint in zip((road['vertexIds'][0], road['vertexIds'][-1]), (path[0], path[-1])):
            connected = [r for r in selection['roads'] if r['id'] != road['id'] and endpoint_id in r.get('vertexIds', [])]
            triangles = [t for r in connected if 'Original_road_'+r['id'] in objects for t in top_triangles(objects['Original_road_'+r['id']], ROAD_Z, ROAD_Z)]
            junction = objects.get('Road_intersection_surfaces')
            if junction:
                triangles += top_triangles(junction, ROAD_Z, ROAD_Z)
            approach = planar_coverage([endpoint], triangles, tolerance*scale)
            passed = bool(connected) and approach['passed']
            check(passed, bid+': a bridge endpoint is detached from the actual bank road.')
            neighbors.append({'sourceVertexId': endpoint_id, 'passed': passed, 'roadIds': [r['id'] for r in connected], 'coverage': approach})
        bridge_results.append({'id': bid, 'roadId': road['id'], 'passed': len(failures) == row_failures,
                               'netWidthSceneUnits': width, 'structuralWidthSceneUnits': outer_width,
                               'walkingCoverage': coverage, 'timberDeckCoverage': deck_coverage,
                               'endpoints': neighbors, 'supports': support_results, 'abutments': abutment_results,
                               'blockers': blockers,
                               'deckObjects': len(decks), 'abutmentObjects': len(abutments), 'railObjects': len(rails)})
    return {'enabled': True, 'version': 1, 'passed': not failures, 'waterLevel': WATER_Z,
            'roadTop': ROAD_Z, 'bedLevel': bed_z, 'verifiedBridges': len(bridge_results),
            'checks': checks, 'bridges': bridge_results, 'failures': failures,
            'limits': 'Static river geometry. Stone arches check the raised walking lane and central opening; legacy timber scenes retain their flat-deck checks. No vessel movement simulation.'}
