"""Verify the saved Blender sample against the untouched planning artifacts.

Run AFTER the renderer has saved its final scene:
  blender --background --python-exit-code 1 --python verify_scene.py
Use --artifact-dir to verify another selection, including a complete city.
The script reads market-quarter.blend itself and writes verification.json.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
OUT = HERE.parents[1] / 'artifacts' / '3d-sample'
parser = argparse.ArgumentParser()
parser.add_argument('--blend', default=None)
parser.add_argument('--artifact-dir', default=str(OUT))
parser.add_argument('--tolerance', type=float, default=1e-4)
opts = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
OUT = Path(opts.artifact_dir).resolve()
blend_path = Path(opts.blend).resolve() if opts.blend else OUT / 'market-quarter.blend'
selection_path = OUT / 'selection.json'
source_path = OUT / 'source-town.json'
manifest_path = OUT / 'scene-manifest.json'
selection = json.loads(selection_path.read_text(encoding='utf-8-sig'))
source = json.loads(source_path.read_text(encoding='utf-8-sig'))
manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
scale = float(manifest['horizontalScale'])
if not math.isfinite(scale) or scale <= 0:
    raise ValueError('The manifest must declare a positive horizontalScale.')
tol = opts.tolerance
bpy.ops.wm.open_mainfile(filepath=str(blend_path))
depsgraph = bpy.context.evaluated_depsgraph_get()
objects_by_name = {o.name: o for o in bpy.context.scene.objects}
failures = []


def check(condition, description):
    if not condition:
        failures.append(description)
    return bool(condition)


def xy(raw):
    return [(p['x'], p['y']) if isinstance(p, dict) else tuple(p[:2]) for p in raw]


def distance_to_segment(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    length2 = dx * dx + dy * dy
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2)) if length2 else 0
    return math.dist(p, (a[0] + t * dx, a[1] + t * dy))


def edges(poly):
    return list(zip(poly, poly[1:] + poly[:1]))


def distance_to_boundary(p, poly):
    return min(distance_to_segment(p, a, b) for a, b in edges(poly))


def signed_area(poly):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in edges(poly)) / 2


def centroid(poly):
    area = signed_area(poly)
    if abs(area) < 1e-12:
        raise ValueError('Degenerate footprint')
    return tuple(sum((a[k] + b[k]) * (a[0] * b[1] - b[0] * a[1]) for a, b in edges(poly)) / (6 * area) for k in (0, 1))


def world_vertices(obj):
    evaluated = obj.evaluated_get(depsgraph)
    return [evaluated.matrix_world @ v.co for v in evaluated.data.vertices]


def bottom_ring(obj):
    evaluated = obj.evaluated_get(depsgraph)
    verts = world_vertices(obj)
    z0 = min(v.z for v in verts)
    faces = [face for face in evaluated.data.polygons if all(abs(verts[i].z - z0) < 1e-5 for i in face.vertices)]
    if len(faces) != 1:
        raise ValueError(f'{obj.name}: expected one intact bottom face, found {len(faces)}')
    return [(verts[i].x / scale, verts[i].y / scale) for i in faces[0].vertices], z0


def polygon_comparison(original, actual):
    from footprint_geometry import compare_footprints
    return compare_footprints(original,actual,scale,tol)


source_vertices = {v['id']: (v['x'], v['y']) for v in source['vertices']}
source_buildings = {b['id']: b for b in source['buildings']}
expected_buildings = {b['id']: b for b in selection['buildings']}
actual_buildings = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name.endswith('_footprint_wall')]
check(len(expected_buildings) == len(selection['buildings']), 'The selection contains duplicate building IDs.')
check(len(actual_buildings) == len(expected_buildings), 'The Blender building count differs from the selected planning data.')
check({o.name.removesuffix('_footprint_wall') for o in actual_buildings} == set(expected_buildings), 'Actual building IDs differ from the selected IDs.')


# A complete-city selection is an adapter, not a crop. Prove that it retained
# every source entity and original boundary, before testing rendered geometry.
whole_city = selection.get('scope') == 'whole-city'
source_integrity = {'scope': selection.get('scope', 'selection'), 'checked': whole_city, 'entities': {}}
if whole_city:
    for category, boundary_key in (('buildings', 'boundary'), ('districts', 'boundary'),
                                    ('roads', 'vertexIds'), ('walls', 'boundary'), ('features', 'boundary')):
        originals = {item['id']: item for item in source.get(category, [])}
        selected = selection.get(category, [])
        identity_key = 'sourceId' if category in ('roads', 'walls') else 'id'
        selected_ids = [item.get(identity_key, item['id']) for item in selected]
        complete = set(selected_ids) == set(originals) and len(selected_ids) == len(set(selected_ids))
        check(complete, f'Complete-city selection omits or duplicates source {category}.')
        changed_ids = []
        for item in selected:
            sid = item.get(identity_key, item['id'])
            original = originals.get(sid)
            if original is None:
                changed_ids.append(sid)
                continue
            unchanged = xy(item['points']) == [source_vertices[vid] for vid in original[boundary_key]]
            for key in {'buildings': ('districtId',), 'districts': ('wardType', 'withinCity', 'withinWalls'),
                        'roads': ('width', 'kind'), 'walls': ('kind', 'activeSegments'),
                        'features': ('kind', 'districtId')}[category]:
                unchanged = unchanged and item.get(key) == original.get(key)
            if category == 'walls':
                expected_gates = [source_vertices[g['vertexId']] for g in source.get('gates', []) if g['wallId'] == sid]
                expected_towers = [source_vertices[vid] for vid in original.get('towerVertexIds', [])]
                unchanged = (unchanged and item.get('closed', True)
                             and sorted(xy(item.get('gatePoints', []))) == sorted(expected_gates)
                             and sorted(xy(item.get('towerPoints', []))) == sorted(expected_towers))
            if not unchanged:
                changed_ids.append(sid)
        check(not changed_ids, f'Complete-city source {category} coordinates or attributes changed: {changed_ids}')
        source_integrity['entities'][category] = {
            'passed': complete and not changed_ids, 'sourceCount': len(originals), 'selectedCount': len(selected),
            'missingIds': sorted(set(originals) - set(selected_ids)),
            'unexpectedIds': sorted(set(selected_ids) - set(originals)), 'changedIds': changed_ids,
        }
    for category in ('gates', 'entrances'):
        originals = source.get(category, [])
        selected = selection.get(category, [])
        selected_by_id = {item['id'] if isinstance(item, dict) else item: item for item in selected}
        original_ids = {item['id'] if isinstance(item, dict) else item for item in originals}
        preserved = set(selected_by_id) == original_ids and len(selected_by_id) == len(selected)
        for original in originals:
            sid = original['id'] if isinstance(original, dict) else original
            item = selected_by_id.get(sid)
            if item is None:
                preserved = False
                continue
            if isinstance(original, dict):
                preserved = preserved and all(item.get(key) == value for key, value in original.items())
            if isinstance(item, dict) and 'point' in item:
                vertex_id = original['vertexId'] if isinstance(original, dict) else original
                preserved = preserved and xy([item['point']])[0] == source_vertices[vertex_id]
        check(preserved, f'Complete-city source {category} identities or coordinates changed.')
        source_integrity['entities'][category] = {'passed': preserved, 'sourceCount': len(originals), 'selectedCount': len(selected)}
    for category in ('river', 'terrain'):
        if category not in source:
            continue
        preserved = selection.get(category) == source[category]
        check(preserved, f'Complete-city source {category} data was not copied unchanged.')
        source_integrity['entities'][category] = {'passed': preserved}
    source_integrity['passed'] = all(item['passed'] for item in source_integrity['entities'].values())

building_results = []
for bid, building in expected_buildings.items():
    obj = objects_by_name.get(bid + '_footprint_wall')
    if not obj:
        check(False, f'Missing building object: {bid}')
        continue
    original = xy(building['points'])
    source_building = source_buildings.get(bid)
    if not check(source_building is not None, f'Selected building is absent from the source: {bid}'):
        continue
    original_from_source = [source_vertices[vid] for vid in source_building['boundary']]
    source_exact = original == original_from_source
    id_valid = (obj.get('source_building_id') == bid and obj.get('source_district_id') == building['districtId']
                and building['districtId'] == source_building['districtId'])
    try:
        actual, z0 = bottom_ring(obj)
        result = polygon_comparison(original, actual)
        result.update(id=bid, object=obj.name, sourceCoordinatesExact=source_exact, sourceIdAndDistrictMatch=id_valid, actualBaseZ=z0)
        result['passed'] = result['passed'] and source_exact and id_valid
        check(result['passed'], f'Building footprint, identity or placement mismatch: {bid}')
        building_results.append(result)
    except Exception as exc:
        check(False, str(exc))
        building_results.append({'id': bid, 'passed': False, 'error': str(exc)})


# Wall bodies are matched to their original active segment, using their actual
# world-space bottom vertices. Decorative coping and merlons are excluded.
wall_results = []
wall_coverage_results = []
wall_body_names = set()
actual_spans = []
for wall in selection.get('walls', []):
    ps = xy(wall['points'])
    pairs = edges(ps) if wall.get('closed', True) else list(zip(ps, ps[1:]))
    active_segments = wall.get('activeSegments', [True] * len(pairs))
    check(len(active_segments) == len(pairs), f'Wall active-segment flags do not match its topology: {wall["id"]}')
    pattern = re.compile(re.escape(wall['id']) + r'_segment_(\d+)_(\d+)$')
    wall_objects = [(o, pattern.fullmatch(o.name)) for o in bpy.context.scene.objects if o.type == 'MESH']
    wall_objects = [(o, match) for o, match in wall_objects if match]
    active_indices = set()
    intervals_by_index = {}
    for obj, match in wall_objects:
        wall_body_names.add(obj.name)
        idx = int(match.group(1))
        valid_index = idx < len(pairs) and idx < len(active_segments)
        is_active = valid_index and bool(active_segments[idx])
        check(is_active, f'Wall object fills an inactive or nonexistent segment: {obj.name}')
        if not valid_index:
            continue
        active_indices.add(idx)
        a, b = pairs[idx]
        length = math.dist(a, b)
        if not check(length > 0, f'Wall source segment has zero length: {wall["id"]}/{idx}'):
            continue
        u = ((b[0] - a[0]) / length, (b[1] - a[1]) / length)
        n = (-u[1], u[0])
        try:
            actual, z0 = bottom_ring(obj)
        except Exception as exc:
            check(False, str(exc))
            continue
        along = [(p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1] for p in actual]
        across = [(p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1] for p in actual]
        centerline_offset = abs((min(across) + max(across)) / 2)
        contained = min(along) >= -tol and max(along) <= length + tol
        intervals_by_index.setdefault(idx, []).append((min(along), max(along)))
        passed = is_active and centerline_offset < tol and contained
        check(passed, f'Wall centerline moved away from its source segment: {obj.name}')
        span = [(a[0] + u[0] * t, a[1] + u[1] * t) for t in (min(along), max(along))]
        actual_spans.append(span)
        wall_results.append({'object': obj.name, 'sourceWallId': wall.get('sourceId', wall['id']), 'sourceSelectedSegmentIndex': idx,
            'passed': passed, 'sourceSegmentActive': is_active, 'centerlineErrorPlanUnits': centerline_offset,
            'entireSpanWithinOriginalSegment': contained, 'restoredActualSpan': span, 'actualBaseZ': z0})
    inactive_indices = {i for i, active in enumerate(active_segments) if not active}
    check(not (active_indices & inactive_indices), f'Inactive wall indices rendered as solid spans: {wall["id"]}')
    for idx, (a, b) in enumerate(pairs):
        if idx >= len(active_segments) or not active_segments[idx]:
            continue
        # Check the union of actual spans, so a missing object or missing piece
        # cannot pass merely because the remaining wall body is on its line.
        length = math.dist(a, b)
        cursor = 0.0
        gaps = []
        intervals = sorted(intervals_by_index.get(idx, []))
        for start, end in intervals:
            if start > cursor + tol:
                gaps.append([cursor, start])
            cursor = max(cursor, end)
        if cursor < length - tol:
            gaps.append([cursor, length])
        passed = bool(intervals) and not gaps
        check(passed, f'Active wall segment is absent or incompletely rendered: {wall["id"]}/{idx}')
        wall_coverage_results.append({'wallId': wall['id'], 'segmentIndex': idx, 'passed': passed,
            'sourceLengthPlanUnits': length, 'actualSpanCount': len(intervals), 'uncoveredIntervalsPlanUnits': gaps})

all_wall_body_names = {o.name for o in bpy.context.scene.objects
                      if o.type == 'MESH' and re.fullmatch(r'.+_segment_\d+_\d+', o.name)}
check(all_wall_body_names == wall_body_names, 'The scene contains wall segment bodies absent from the selection.')

manifest_spans = [[(p[0] / scale, p[1] / scale) for p in span] for span in manifest.get('wallSpans', [])]
span_manifest_error = 0.0
for actual in actual_spans:
    if not manifest_spans:
        span_manifest_error = float('inf')
        break
    span_manifest_error = max(span_manifest_error, min(min(max(math.dist(actual[0], span[0]), math.dist(actual[1], span[1])),
        max(math.dist(actual[0], span[1]), math.dist(actual[1], span[0]))) for span in manifest_spans))
check(len(actual_spans) == len(manifest_spans) and span_manifest_error < tol, 'Actual wall spans differ from the manifest.')


# Confirm that the center of each original gate is unobstructed near ground.
# An intentional gate bridge above the opening is permitted.
gate_results = []
wall_collection = bpy.data.collections.get('02_CITY_WALL')
wall_meshes = [o for o in wall_collection.all_objects if o.type == 'MESH'] if wall_collection else []
for wall in selection.get('walls', []):
    for i, gate in enumerate(xy(wall.get('gatePoints', []))):
        origin = Vector((gate[0] * scale, gate[1] * scale, -0.1))
        blockers = []
        for obj in wall_meshes:
            evaluated = obj.evaluated_get(depsgraph)
            inverse = evaluated.matrix_world.inverted()
            local_origin = inverse @ origin
            local_direction = (inverse.to_3x3() @ Vector((0, 0, 1))).normalized()
            hit, loc, normal, face = evaluated.ray_cast(local_origin, local_direction)
            if hit:
                world_hit = evaluated.matrix_world @ loc
                if -0.01 <= world_hit.z <= 2.1:
                    blockers.append(obj.name)
        passed = not blockers
        check(passed, f'Original gate center is obstructed below 2.1 scene units: {wall["id"]}/{i}')
        gate_results.append({'wallId': wall['id'], 'gateIndex': i, 'sourcePoint': gate, 'passed': passed, 'blockingObjectsBelow2_1': blockers})


# Ground-road geometry is composed of one quad per centerline segment. Verify
# expected segment-side corners and scaled widths against actual world vertices.
road_results = []
expected_road_ids = [r['id'] for r in selection.get('roads', [])]
actual_road_ids = [o.name.removeprefix('Original_road_') for o in bpy.context.scene.objects
                   if o.type == 'MESH' and o.name.startswith('Original_road_')]
check(len(expected_road_ids) == len(set(expected_road_ids)), 'The selection contains duplicate road IDs.')
check(sorted(expected_road_ids) == sorted(actual_road_ids), 'Actual road IDs differ from the selected IDs.')
for road in selection.get('roads', []):
    obj = objects_by_name.get('Original_road_' + road['id'])
    if not obj:
        check(False, f'Missing planned road: {road["id"]}')
        continue
    ps = xy(road['points'])
    expected = []
    for a, b in zip(ps, ps[1:]):
        length = math.dist(a, b)
        if length == 0:
            continue
        nx, ny = -(b[1] - a[1]) / length * road['width'] / 2, (b[0] - a[0]) / length * road['width'] / 2
        expected.extend([(a[0] + nx, a[1] + ny), (a[0] - nx, a[1] - ny), (b[0] - nx, b[1] - ny), (b[0] + nx, b[1] + ny)])
    road_vertices=world_vertices(obj)
    actual = [(p.x / scale, p.y / scale) for p in road_vertices]
    joined=obj.get('road_surface_version',0)>=2
    prefix=actual[:len(expected)]
    max_error=max((math.dist(p,q) for p,q in zip(prefix,expected)),default=0)
    added=actual[len(expected):]
    radius_error=max((min(distance_to_segment(p,a,b) for a,b in zip(ps,ps[1:]))-road['width']/2 for p in added),default=0)
    passed=len(prefix)==len(expected) and max_error<tol and (len(actual)==len(expected) or joined and radius_error<tol)
    road_checks={'sourceWidthAndCoordinates':passed}
    coverage=None
    if joined:
        from planar_coverage import planar_coverage
        obj.data.calc_loop_triangles()
        triangles=[[(road_vertices[i].x,road_vertices[i].y) for i in triangle.vertices] for triangle in obj.data.loop_triangles]
        samples=ps+[tuple((a[i]+b[i])/2 for i in (0,1)) for a,b in zip(ps,ps[1:])]
        coverage=planar_coverage([(p[0]*scale,p[1]*scale) for p in samples],triangles,tol*scale)
        upward=all(f.normal.z>0 for f in obj.data.polygons)
        arch_bridge=manifest.get('river',{}).get('version',1)>=2 and any(b['roadId']==road['id'] for b in source.get('river',{}).get('bridges',[]))
        if arch_bridge:
            from bridge_geometry import height_at
            path=[(x*scale,y*scale) for x,y in ps]
            correct_height=all(abs(p.z-height_at((p.x,p.y),path))<tol for p in road_vertices)
        else:correct_height=all(abs(p.z-.035)<tol for p in road_vertices)
        road_checks.update(centerlineCoverage=coverage['passed'],upwardFaces=upward,height=correct_height)
        if obj.get('road_surface_version',0)>=3:
            from harbor_geometry import area,subtract_convex
            polygons=[[(road_vertices[i].x,road_vertices[i].y) for i in f.vertices] for f in obj.data.polygons]
            max_overlap=0
            for i,p in enumerate(polygons):
                for q in polygons[:i]:
                    overlap=area(p)-sum(area(part) for part in subtract_convex(p,q))
                    max_overlap=max(max_overlap,overlap)
            # Bound the area effect of float32 edge storage using the existing
            # positional tolerance, rather than accepting overlapping ribbons.
            road_checks['nonOverlappingPaving']=max_overlap<tol*road['width']*scale
    passed=all(road_checks.values())
    failed_checks=[name for name,ok in road_checks.items() if not ok]
    check(passed, f'Road surface verification failed: {road["id"]} ({", ".join(failed_checks)})')
    road_results.append({'id': road['id'], 'sourceId': road.get('sourceId', road['id']), 'passed': passed,
        'originalWidthPlanUnits': road['width'], 'expectedWidthSceneUnits': road['width'] * scale,
        'maxCornerErrorPlanUnits': max_error, 'actualVertexCount': len(actual),'roundJoinVertices':len(added),'maxJoinExcursionPlanUnits':radius_error,
        'checks':road_checks,'coverage':coverage})


from verify_markets import verify_markets
market_results = verify_markets(selection,manifest,scale,tolerance=tol)
for message in market_results.get('failures',[]):check(False,message)
# Keep the old first-plaza result for consumers of historical reports, while
# markets is the authoritative complete list in new scene reports.
plaza_result = (market_results['plazas'][0]['footprint'] if market_results['plazas']
                else {'passed':market_results['passed'],'presentInPlan':False})

# Every planned feature needs an explicit scene representation, even when its
# asset is a placeholder. Grove regions and fountain bases retain their exact
# planned footprints; tree placement and fountain superstructures are designed
# interpretations within those regions.
feature_results = []
if whole_city:
    feature_objects = {}
    for obj in bpy.context.scene.objects:
        if obj.get('source_feature_id'):
            feature_objects.setdefault(str(obj['source_feature_id']), []).append(obj)
    planned_feature_ids = {feature['id'] for feature in selection.get('features', [])}
    check(set(feature_objects) == planned_feature_ids, 'Actual feature source IDs differ from the complete-city planned features.')
    for feature in selection.get('features', []):
        objects = feature_objects.get(feature['id'], [])
        item = {'id': feature['id'], 'kind': feature['kind'], 'passed': bool(objects),
                'taggedObjects': [obj.name for obj in objects], 'footprintChecked': False}
        if feature['kind'] in ('grove', 'fountain'):
            obj = objects_by_name.get('Planning_' + feature['kind'] + '_' + feature['id'])
            item['passed'] = item['passed'] and obj is not None
            if obj:
                item['passed'] = item['passed'] and obj.get('source_feature_id') == feature['id']
                if feature['kind'] == 'fountain':
                    item['passed'] = (item['passed'] and obj.get('asset_kind') == 'fountain'
                                      and obj.get('asset_role') == 'exact_footprint_base')
                try:
                    actual, z0 = bottom_ring(obj)
                    item['footprintComparison'] = polygon_comparison(xy(feature['points']), actual)
                    item['footprintChecked'] = True
                    item['passed'] = item['passed'] and item['footprintComparison']['passed']
                    item['actualBaseZ'] = z0
                except Exception as exc:
                    item.update(passed=False, error=str(exc))
        check(item['passed'], f'Planned feature is missing or its required region footprint changed: {feature["id"]}')
        feature_results.append(item)
    feature_manifest = manifest.get('planningFeatures', {})
    check(set(feature_manifest.get('representedSourceFeatureIds', [])) == set(feature_objects),
          'Feature manifest represented IDs differ from actual source-tagged objects.')
    check(set(feature_manifest.get('unrepresentedSourceFeatureIds', [])) == planned_feature_ids - set(feature_objects),
          'Feature manifest unrepresented IDs differ from actual missing source features.')

tower_results=[]
if manifest.get('roadSurfaces',{}).get('version',0)>=2:
    bodies=[o for o in bpy.context.scene.objects if o.get('source_tower_vertex_id')]
    expected_towers={(w['id'],vid) for w in selection['walls'] for vid in w.get('renderTowerVertexIds',w.get('towerVertexIds',[]))}
    check({(o.get('source_wall_id'),o.get('source_tower_vertex_id')) for o in bodies}==expected_towers,'Actual tower placements differ from the declared spacing plan.')
    for i,obj in enumerate(bodies):
        v=world_vertices(obj);c=(sum(p.x for p in v)/len(v),sum(p.y for p in v)/len(v));radius=max(math.dist(c,(p.x,p.y)) for p in v)
        source_point=source_vertices[obj['source_tower_vertex_id']]
        passed=math.dist(c,(source_point[0]*scale,source_point[1]*scale))<tol
        for other in bodies[:i]:
            ov=world_vertices(other);oc=(sum(p.x for p in ov)/len(ov),sum(p.y for p in ov)/len(ov));orr=max(math.dist(oc,(p.x,p.y)) for p in ov)
            if math.dist(c,oc)<radius+orr+.5:passed=False
        check(passed,obj.name+': a wall tower moved or overlaps another tower.')
        tower_results.append({'object':obj.name,'sourceVertexId':obj['source_tower_vertex_id'],'passed':passed})

from verify_integrated_assets import verify_assets
authored_results=verify_assets(selection,manifest,scale)
for message in authored_results.get('failures',[]):check(False,message)
from verify_harbor import verify_harbor
harbor_results=verify_harbor(selection,manifest,scale)
for message in harbor_results.get('failures',[]):check(False,message)
from verify_river import verify_river
river_results=verify_river(selection,manifest,scale,source=source,tolerance=tol)
for message in river_results.get('failures',[]):check(False,message)
from verify_estuary import verify_estuary
estuary_results=verify_estuary(selection,manifest,scale,source=source,tolerance=tol)
for message in estuary_results.get('failures',[]):check(False,message)

result = {
    'status': 'pass' if not failures else 'fail',
    'sceneFile': blend_path.name, 'horizontalScale': scale,
    'coordinateMapping': 'scene.x = planning.x * horizontalScale; scene.y = planning.y * horizontalScale; no XY translation or rotation',
    'verificationMethod': 'Read the saved Blender scene, evaluate world-space mesh vertices, undo the documented uniform XY scale, and compare to selection.json and source-town.json. Collinear roof-generated base points are permitted.',
    'boundaryTolerancePlanUnits': tol,
    'counts': {'expectedBuildings': len(expected_buildings), 'actualBuildingFootprintObjects': len(actual_buildings),
        'verifiedBuildings': len(building_results), 'verifiedRoads': len(road_results), 'wallBodySpans': len(wall_results),
        'expectedActiveWallSegments': len(wall_coverage_results), 'verifiedGateCenters': len(gate_results),
        'verifiedSourceFeatures': len(feature_results), 'verifiedBridges': river_results.get('verifiedBridges',0),
        'verifiedMarkets': sum(row['passed'] for row in market_results['plazas'])},
    'sourceFilesSha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (source_path, selection_path, manifest_path, blend_path)},
    'maxBuildingBoundaryErrorPlanUnits': max((max(r.get('maxActualToSourceBoundaryErrorPlanUnits', 0), r.get('maxSourceToActualBoundaryErrorPlanUnits', 0)) for r in building_results), default=0),
    'maxBuildingCentroidErrorPlanUnits': max((r.get('centroidErrorPlanUnits', 0) for r in building_results), default=0),
    'wallManifestMaxEndpointErrorPlanUnits': span_manifest_error,
    'sourceIntegrity': source_integrity,
    'buildings': building_results, 'walls': wall_results, 'wallCoverage': wall_coverage_results,
    'gates': gate_results, 'roads': road_results, 'plaza': plaza_result, 'markets':market_results, 'features': feature_results,
    'assetIntegration':authored_results,
    'towerPlacements':tower_results,
    'harbor':harbor_results,
    'river':river_results,
    'estuary':estuary_results,
    'failures': failures,
    'limits': [
        'Structural checks concern the ground footprint and original centerlines. Roof height, facade details, towers, parapets, gates and market props are designed interpretations.',
        'Gate checks verify original centers below 2.1 scene units, not a complete navigation mesh or every point across gate width.',
        'Decorative facade elements may project slightly beyond the preserved wall footprint.',
        'Complete-city features must have source-tagged scene objects; grove region and fountain base footprints are checked. Procedural placeholders count as representations, not finished production assets.',
    ],
}
(OUT / 'verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: result[key] for key in ('status', 'counts', 'horizontalScale', 'maxBuildingBoundaryErrorPlanUnits', 'failures')}, indent=2))
if failures:
    raise RuntimeError(f'Scene verification failed: {len(failures)} checks; see verification.json')
