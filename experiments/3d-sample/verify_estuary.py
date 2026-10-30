"""Independently verify a saved river mouth against both source water regions.

Expected coverage is calculated from untouched source polygons and Blender's
own triangulation. No assembler-derived water or land outline is trusted.
"""
import math

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import tessellate_polygon

from footprint_geometry import signed_area
from harbor_geometry import inside, hull_ring
from verify_river import xy, bounds, boxes_overlap, convex_intersection, overlap_area

WATER_Z = -1.15


def source_triangles(raw, scale):
    points = [Vector((x*scale, y*scale, 0)) for x, y in xy(raw)]
    result = []
    for triangle in tessellate_polygon([points]):
        polygon = [(points[p].x, points[p].y) if isinstance(p, int) else (p.x, p.y)
                   for p in triangle]
        if signed_area(polygon) < 0:
            polygon.reverse()
        if abs(signed_area(polygon)) > 1e-12:
            result.append((polygon, bounds(polygon)))
    return result


def mesh_triangles(obj, tolerance, low=-math.inf, high=math.inf):
    obj.data.calc_loop_triangles()
    vertices = [obj.matrix_world@v.co for v in obj.data.vertices]
    triangles = []
    for triangle in obj.data.loop_triangles:
        points = [vertices[i] for i in triangle.vertices]
        polygon = [(p.x, p.y) for p in points]
        if min(p.z for p in points) >= low-tolerance and max(p.z for p in points) <= high+tolerance and signed_area(polygon) > 1e-12:
            triangles.append((polygon, bounds(polygon)))
    return vertices, triangles


def shared_area(first, second):
    return sum(overlap_area(triangle, second) for triangle, _ in first)


def mouth_segments(shoreline, river_surface, scale):
    """Split the original shoreline at exact source river intersections."""
    river = [(x*scale, y*scale) for x, y in xy(river_surface)]
    shore = [(x*scale, y*scale) for x, y in xy(shoreline)]
    result = []
    for index, (a, b) in enumerate(zip(shore, shore[1:])):
        dx, dy = b[0]-a[0], b[1]-a[1]
        cuts = [0., 1.]
        for c, d in zip(river, river[1:]+river[:1]):
            ex, ey = d[0]-c[0], d[1]-c[1]
            determinant = dx*ey-dy*ex
            if abs(determinant) < 1e-12:
                continue
            t = ((c[0]-a[0])*ey-(c[1]-a[1])*ex)/determinant
            u = ((c[0]-a[0])*dy-(c[1]-a[1])*dx)/determinant
            if -1e-10 <= t <= 1+1e-10 and -1e-10 <= u <= 1+1e-10:
                cuts.append(max(0., min(1., t)))
        cuts = sorted(set(cuts))
        for lo, hi in zip(cuts, cuts[1:]):
            if hi-lo < 1e-9:
                continue
            mid = (a[0]+dx*(lo+hi)/2, a[1]+dy*(lo+hi)/2)
            if inside(mid, river):
                result.append({'shoreSegment': index,
                    'points': [(a[0]+dx*lo, a[1]+dy*lo), (a[0]+dx*hi, a[1]+dy*hi)]})
    return result


def verify_estuary(selection, manifest, scale, source=None, tolerance=1e-4):
    plan = source or selection
    coast = plan.get('terrain', {}).get('coast')
    river = plan.get('river')
    data = manifest.get('estuary', {})
    if not (coast and river):
        passed = not data.get('enabled')
        return {'enabled': False, 'passed': passed, 'checks': [], 'failures': [] if passed else ['Estuary geometry was added without both source water regions.']}
    failures, checks = [], []
    def check(value, message):
        if not value:
            failures.append(message)
        return bool(value)
    check(data.get('enabled') and data.get('version') == 1, 'The source river mouth has no current combined-water representation.')
    objects = {obj.name: obj for obj in bpy.context.scene.objects if obj.type == 'MESH'}
    sea_source = source_triangles(coast['water'], scale)
    river_source = source_triangles(river['surface'], scale)
    sea_area = sum(abs(signed_area(p)) for p, _ in sea_source)
    river_area = sum(abs(signed_area(p)) for p, _ in river_source)
    source_overlap = shared_area(river_source, sea_source)
    river_only_area = river_area-source_overlap
    union_area = sea_area+river_only_area
    area_tolerance = max(.002, union_area*1e-6)
    river_tolerance = max(.0002, river_only_area*1e-6)
    sea = objects.get('Harbor_sea_surface')
    channel = objects.get('River_water_surface')
    check(sea is not None and channel is not None, 'Both the source sea and clipped river water meshes are required.')
    sea_actual, river_actual = [], []
    for obj, target, role in ((sea, sea_actual, 'sea'), (channel, river_actual, 'river')):
        if obj is None:
            continue
        vertices, triangles = mesh_triangles(obj, tolerance, WATER_Z, WATER_Z)
        check(bool(vertices) and all(abs(p.z-WATER_Z) <= tolerance for p in vertices), 'The actual '+role+' water level is inconsistent at the river mouth.')
        check(bool(triangles), 'The actual '+role+' water has no upward source coverage.')
        target.extend(triangles)
    actual_channel_area = sum(abs(signed_area(p)) for p, _ in river_actual)
    outside_channel = max(0., actual_channel_area-shared_area(river_actual, river_source))
    channel_sea_overlap = shared_area(river_actual, sea_source)
    actual_overlap = shared_area(river_actual, sea_actual)
    self_overlap = 0.
    for i, (triangle, box) in enumerate(river_actual):
        for other, other_box in river_actual[:i]:
            if boxes_overlap(box, other_box):
                intersection = convex_intersection(triangle, other)
                if len(intersection) >= 3:
                    self_overlap += abs(signed_area(intersection))
    from verify_port_water import river_hulls, hull_overlap
    river_hull_rings=river_hulls(objects)
    river_hull_area=sum(abs(signed_area(ring)) for ring in river_hull_rings)
    flooded_river_area=hull_overlap([p for p,_ in river_actual],river_hull_rings)
    channel_passed = (abs(actual_channel_area-(river_only_area-river_hull_area)) <= river_tolerance
                      and flooded_river_area <= river_tolerance
                      and outside_channel <= river_tolerance
                      and channel_sea_overlap <= river_tolerance
                      and actual_overlap <= river_tolerance and self_overlap <= river_tolerance)
    check(channel_passed, 'The river-only water coverage differs from source river minus sea, or river and sea overlap.')
    checks.append({'kind': 'source_river_minus_sea', 'passed': channel_passed,
        'sourceRiverAreaSceneUnits2': river_area, 'sourceOverlapAreaSceneUnits2': source_overlap,
        'expectedRiverOnlyAreaSceneUnits2': river_only_area-river_hull_area, 'actualRiverOnlyAreaSceneUnits2': actual_channel_area,
        'riverHullExclusionAreaSceneUnits2': river_hull_area,'floodedRiverHullAreaSceneUnits2': flooded_river_area,
        'outsideSourceRiverAreaSceneUnits2': outside_channel, 'riverInSourceSeaAreaSceneUnits2': channel_sea_overlap,
        'actualWaterOverlapAreaSceneUnits2': actual_overlap, 'riverSelfOverlapAreaSceneUnits2': self_overlap,
        'areaToleranceSceneUnits2': river_tolerance})
    excluded_hulls = 0.
    for boat in objects.values():
        if boat.get('asset_mount_role') != 'harbor_boat':
            continue
        import json
        profile = json.loads(boat.get('hull_profile', '{}'))
        if profile:
            points = [boat.matrix_world@Vector((x, y, 0)) for x, y in hull_ring(profile)]
            excluded_hulls += abs(signed_area([(p.x, p.y) for p in points]))
    actual_union_area = sum(abs(signed_area(p)) for p, _ in sea_actual)+actual_channel_area
    union_passed = abs(actual_union_area-(union_area-excluded_hulls)) <= area_tolerance
    check(union_passed, 'The actual combined water does not cover the source sea-river union after boat exclusions.')
    checks.append({'kind': 'source_water_union', 'passed': union_passed,
        'actualWaterAreaSceneUnits2': actual_union_area, 'expectedWaterAreaSceneUnits2': union_area-excluded_hulls,
        'sourceUnionAreaSceneUnits2': union_area, 'excludedHullAreaSceneUnits2': excluded_hulls,
        'areaToleranceSceneUnits2': area_tolerance})
    land_names = list(data.get('landObjects', []))
    bank_names = list(data.get('bankObjects', []))
    declared = land_names+bank_names
    check(len(land_names) >= 2 and len(declared) == len(set(declared)) and all(name in objects for name in declared),
          'The source river mouth must retain all declared dry banks without duplicates.')
    actual_land = {obj.name for obj in objects.values() if obj.get('source_terrain_role') in ('river_land', 'river_bank')}
    check(actual_land == set(declared), 'Actual combined-water terrain differs from its declared dry-bank objects.')
    dry_area = 0.
    for name in declared:
        if name in objects:
            _, triangles = mesh_triangles(objects[name], tolerance, -math.inf, tolerance)
            dry_area += sum(abs(signed_area(p)) for p, _ in triangles)
    crop_area = abs(signed_area([(x*scale, y*scale) for x, y in xy(selection['cropPolygon'])]))
    expected_dry_area = crop_area-union_area
    dry_passed = abs(dry_area-expected_dry_area) <= max(.002, crop_area*1e-6)
    bridge_roads = {bridge['roadId'] for bridge in river.get('bridges', [])}
    ground = {name: objects[name] for name in declared if name in objects}
    collection = bpy.data.collections.get('00_GROUND')
    if collection:
        for obj in collection.all_objects:
            if obj.type == 'MESH' and obj.name not in ('River_bed',) and not (
                obj.name.startswith('Original_road_') and obj.name.removeprefix('Original_road_') in bridge_roads):
                ground[obj.name] = obj
    ground_overlaps = []
    for obj in ground.values():
        _, triangles = mesh_triangles(obj, tolerance, WATER_Z-.061, .04)
        wet = shared_area(triangles, sea_source)+shared_area(triangles, river_source)
        if wet > max(.0002, crop_area*1e-8):
            ground_overlaps.append({'object': obj.name, 'overlapAreaSceneUnits2': wet})
    check(dry_passed and not ground_overlaps, 'Dry land or non-bridge paving covers the source estuary water, or leaves dry-bank holes.')
    checks.append({'kind': 'combined_land_water_partition', 'passed': dry_passed and not ground_overlaps,
        'actualDryAreaSceneUnits2': dry_area, 'expectedDryAreaSceneUnits2': expected_dry_area,
        'overlaps': ground_overlaps, 'areaToleranceSceneUnits2': max(.002, crop_area*1e-6)})
    mouths = mouth_segments(coast['shoreline'], river['surface'], scale)
    check(bool(mouths), 'The original river does not reach the source coastline.')
    mouth_results = []
    for row in mouths:
        a, b = row['points']
        length = math.dist(a, b)
        probes = [(a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t)
                  for t in ((i+.5)/max(3, math.ceil(length/.5)) for i in range(max(3, math.ceil(length/.5))))]
        box = bounds([a, b]); blockers = []
        for obj in objects.values():
            if obj.get('environment_extent') or obj.get('source_terrain_role') in ('sea', 'river_water', 'river_ripples', 'river_shallow', 'river_bed'):
                continue
            vertices = [obj.matrix_world@Vector(point) for point in obj.bound_box]
            if max(p.z for p in vertices) < WATER_Z+.02 or min(p.z for p in vertices) > 2.1:
                continue
            if not boxes_overlap(box, bounds([(p.x, p.y) for p in vertices]), tolerance):
                continue
            actual = [obj.matrix_world@vertex.co for vertex in obj.data.vertices]
            tree = BVHTree.FromPolygons(actual, [tuple(face.vertices) for face in obj.data.polygons])
            hits = sum(tree.ray_cast(Vector((x,y,WATER_Z+.02)), Vector((0,0,1)), 3.3)[0] is not None for x,y in probes)
            if hits:
                blockers.append({'object': obj.name, 'blockedSamples': hits})
        passed = not blockers
        check(passed, 'An actual retaining wall, bank cap or prop blocks the source river mouth.')
        mouth_results.append({**row, 'passed': passed, 'sampleCount': len(probes), 'blockers': blockers})
    checks.append({'kind': 'source_mouth_openings', 'passed': bool(mouths) and all(row['passed'] for row in mouth_results),
                   'segments': mouth_results})
    return {'enabled': True, 'version': 1, 'passed': not failures, 'waterLevel': WATER_Z,
            'checks': checks, 'mouthSegments': mouth_results, 'failures': failures,
            'method': 'Independent source-polygon intersections and saved mesh triangles; no derived assembler outline is used.'}
