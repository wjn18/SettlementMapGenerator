"""Inspect every planned market and its actual saved, source-tagged contents."""
import math
from collections import Counter

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from footprint_geometry import compare_footprints
from harbor_geometry import inside, segment_distance

KINDS = {'market_stall': 'stalls', 'person': 'people', 'well': 'well',
         'hand_cart': 'cart', 'cargo': 'cargo_groups', 'statue': 'statues'}


def xy(raw):
    return [(float(p['x']), float(p['y'])) if isinstance(p, dict) else tuple(p[:2]) for p in raw]


def verify_markets(selection, manifest, scale, tolerance=1e-4):
    """Use selected source districts, never manifest outlines, as authority.

    The old singleton object remains readable for old single-market scenes.
    New multiple-market scenes require explicit ground and contents ownership.
    Existing feature verification separately checks every fountain/statue ID.
    """
    failures, rows = [], []
    def check(value, message):
        if not value:
            failures.append(message)
        return bool(value)
    expected_list = [district for district in selection.get('districts', []) if district.get('wardType') == 'Market']
    if not expected_list and selection.get('plaza') and selection.get('scope') != 'whole-city':
        expected_list = [selection['plaza']]
    expected = {str(district['id']): district for district in expected_list}
    check(len(expected) == len(expected_list), 'Source market district IDs are duplicated.')
    data = manifest.get('markets', {})
    modern = bool(data)
    declared_list = data.get('plazas', []) if modern else []
    declared = {str(row.get('id')): row for row in declared_list}
    if modern:
        check(data.get('version') == 1, 'The market assembly version is unsupported.')
        check(len(declared) == len(declared_list) and set(declared) == set(expected),
              'Market manifest IDs differ from the source market districts.')
    else:
        check(len(expected) <= 1, 'Multiple source markets require separate assembly and verification records.')
    listed_selection = selection.get('plazas')
    if listed_selection is not None:
        check(len(listed_selection) == len(expected) and {str(p['id']) for p in listed_selection} == set(expected),
              'The adapter market list differs from the source market districts.')
    objects = {obj.name: obj for obj in bpy.context.scene.objects if obj.type == 'MESH'}
    grounds = [obj for obj in objects.values() if obj.get('asset_kind') == 'market_plaza'
               or obj.name == 'Original_market_square' or obj.name.startswith('Original_market_square_')
               or obj.name.startswith('Original_market_square.')]
    if modern:
        check(len(grounds) == len(expected), 'Actual market ground count differs from the source market count.')
        check({str(obj.get('source_market_id')) for obj in grounds} == set(expected),
              'Actual market ground IDs differ from the source market districts.')
    else:
        check(len(grounds) == len(expected), 'The legacy market ground is missing or was added without a source plaza.')
    source_features = {str(item['id']): str(item['districtId']) for item in selection.get('features', [])}
    market_feature_ids = {fid for fid, mid in source_features.items() if mid in expected}
    source_polys = {mid: [(x*scale, y*scale) for x,y in xy(district['points'])] for mid,district in expected.items()}
    depsgraph = bpy.context.evaluated_depsgraph_get()
    geometry_cache = {}
    def geometry(obj):
        if obj.name not in geometry_cache:
            evaluated = obj.evaluated_get(depsgraph)
            evaluated.data.calc_loop_triangles()
            vertices = [evaluated.matrix_world@vertex.co for vertex in evaluated.data.vertices]
            triangles = [tuple(face.vertices) for face in evaluated.data.loop_triangles]
            geometry_cache[obj.name] = (vertices, triangles, evaluated.data.polygons)
        return geometry_cache[obj.name]
    def near_boundary(point, polygon):
        return min(segment_distance(point,a,b) for a,b in zip(polygon,polygon[1:]+polygon[:1]))
    def contained(point, polygon):
        return inside(point,polygon) or near_boundary(point,polygon) <= tolerance*scale
    ground_names = {obj.name for obj in grounds}
    tagged = [obj for obj in objects.values() if obj.get('source_market_id') is not None and obj.name not in ground_names]
    feature_checks=[]
    if modern:
        for obj in tagged:
            check(str(obj.get('source_market_id')) in expected, obj.name+': contents reference an unplanned market.')
        for obj in objects.values():
            kind, role = obj.get('asset_kind'), obj.get('asset_mount_role')
            relevant = kind in KINDS or role == 'market_goods'
            if kind == 'statue' and obj.get('source_feature_id') and str(obj['source_feature_id']) not in market_feature_ids:
                relevant = False
            if relevant:
                check(str(obj.get('source_market_id')) in expected,
                      obj.name+': market contents have no valid source market ID.')
            fid = str(obj.get('source_feature_id', ''))
            if fid in market_feature_ids:
                check(str(obj.get('source_market_id')) == source_features[fid],
                      obj.name+': planned market feature belongs to another market.')
        for feature in selection.get('features',[]):
            fid=str(feature['id']);kind=feature.get('kind')
            if fid not in market_feature_ids or kind not in ('fountain','statue'):continue
            parts=[obj for obj in objects.values() if str(obj.get('source_feature_id',''))==fid]
            primary=[obj for obj in parts if obj.get('asset_role')=='exact_footprint_base'] if kind=='fountain' else [obj for obj in parts if obj.get('asset_kind')=='statue' and obj.get('input_footprint_xy')]
            passed=len(primary)==1
            check(passed,fid+': planned market feature primary geometry is missing or duplicated.')
            feature_checks.append({'id':fid,'kind':kind,'marketId':source_features[fid],
                                   'passed':passed,'primaryObjects':[obj.name for obj in primary]})
    all_owned = {}
    for mid, district in expected.items():
        start = len(failures)
        record = declared.get(mid, {})
        candidates = [obj for obj in grounds if str(obj.get('source_market_id')) == mid] if modern else grounds
        check(len(candidates) == 1, mid+': expected one separately identified market ground.')
        obj = candidates[0] if len(candidates) == 1 else None
        footprint = {'passed': False, 'presentInPlan': True, 'id': mid}
        if obj:
            if modern:
                check(record.get('groundObject') == obj.name, mid+': the recorded ground object differs from the saved market.')
                check(str(obj.get('source_district_id')) == mid, mid+': market ground district ownership changed.')
            vertices, _, polygons = geometry(obj)
            if vertices:
                bottom = min(p.z for p in vertices)
                base_faces = [face for face in polygons if all(abs(vertices[i].z-bottom) < 1e-5 for i in face.vertices)]
                if check(len(base_faces) == 1, mid+': market ground has no intact source footprint.'):
                    actual = [(vertices[i].x/scale,vertices[i].y/scale) for i in base_faces[0].vertices]
                    footprint = compare_footprints(xy(district['points']), actual, scale, tolerance)
                    footprint.update(id=mid,presentInPlan=True,actualBaseZ=bottom)
                    check(footprint['passed'], mid+': actual market footprint differs from its source district.')
                check(abs(bottom-.005) < tolerance and abs(max(v.z for v in vertices)-.025) < tolerance,
                      mid+': market paving height differs from the planned ground datum.')
            else:
                check(False, mid+': market ground has no actual vertices.')
        contents = [item for item in tagged if str(item.get('source_market_id')) == mid] if modern else []
        all_owned[mid] = contents
        if modern:
            names = list(record.get('objects', []))
            actual_names = {item.name for item in contents}
            check(len(names) == len(set(names)) and set(names) == actual_names,
                  mid+': the final market contents list omits, duplicates or adds actual objects.')
            stats = record.get('props', {})
            if 'objects' in stats:
                check(stats['objects'] == len(actual_names), mid+': recorded market object count differs from the saved contents.')
            actual_counts = Counter(KINDS[item.get('asset_kind')] for item in contents if item.get('asset_kind') in KINDS)
            for key in KINDS.values():
                check(int(stats.get(key,0)) == actual_counts.get(key,0), mid+': '+key+' count differs from the saved market contents.')
            if data.get('propsEnabled', True) and not sum(actual_counts.values()):
                check(bool(stats.get('emptyReason')) or bool(record.get('emptyReason')),
                      mid+': an empty market has no recorded capacity or placement explanation.')
            ownership_failures = []
            for item in contents:
                vertices, _, _ = geometry(item)
                if not vertices:
                    check(False, item.name+': a recorded market object has no actual geometry.')
                    continue
                kind = item.get('asset_kind')
                # Static ground footprints belong to this plaza; awnings and
                # other elevated ornaments may overhang their ground bases.
                if kind in KINDS and kind != 'person':
                    zmin=min(v.z for v in vertices)
                    probes=[(v.x,v.y) for v in vertices if v.z <= zmin+.25]
                    if any(not contained(p,source_polys[mid]) for p in probes):
                        ownership_failures.append({'object':item.name,'reason':'static base leaves its source market'})
                for other, polygon in source_polys.items():
                    if other == mid:
                        continue
                    if any(inside((v.x,v.y),polygon) and near_boundary((v.x,v.y),polygon) > tolerance*scale
                           and not contained((v.x,v.y),source_polys[mid]) for v in vertices):
                        ownership_failures.append({'object':item.name,'reason':'contents intrude into another market','otherMarketId':other})
                        break
            check(not ownership_failures, mid+': actual contents leave their owning plaza or intrude into another market.')
        else:
            actual_counts, ownership_failures = {}, []
        rows.append({'id':mid,'passed':len(failures)==start,'groundObject':obj.name if obj else None,
                     'footprint':footprint,'contents':len(contents),'counts':dict(actual_counts),
                     'ownershipFailures':ownership_failures})
    # Shared placement is audited from world-space saved triangles. In
    # particular, a market's overflow figures cannot intersect its neighbor's.
    collision_objects = [obj for values in all_owned.values() for obj in values
                         if obj.get('asset_kind') in KINDS or obj.get('asset_mount_role') == 'market_goods']
    fortifications={}
    walls=bpy.data.collections.get('02_CITY_WALL')
    if walls:
        fortifications.update({obj.name:obj for obj in walls.all_objects if obj.type=='MESH' and obj.name in objects})
    fortifications.update({obj.name:obj for obj in objects.values() if obj.get('source_wall_id')})
    if modern:
        structure_targets=[obj for values in all_owned.values() for obj in values
                           if obj.get('asset_role')!='exact_footprint_base']
    else:
        # Legacy single-market objects have no market-ID metadata, but their
        # actual props and citizen meshes still need fortification clearance.
        structure_targets=[obj for obj in objects.values() if expected and
                           (obj.get('asset_kind') in KINDS or obj.get('asset_mount_role') in ('citizen','market_goods'))
                           and obj.get('asset_role')!='exact_footprint_base']
    boxes, trees, conflicts = {}, {}, []
    collision_geometry={obj.name:obj for obj in collision_objects+structure_targets+list(fortifications.values())}
    for obj in collision_geometry.values():
        vertices, triangles, _ = geometry(obj)
        if vertices and triangles:
            boxes[obj.name]=([min(p[i] for p in vertices) for i in range(3)],
                             [max(p[i] for p in vertices) for i in range(3)])
            trees[obj.name]=BVHTree.FromPolygons(vertices,triangles,all_triangles=True)
    def interior(point,tree,distance):
        # BVH triangle overlap alone misses coincident or nested closed
        # volumes. Count distinct ray crossings from an interior probe.
        direction=Vector((.863,.317,.391)).normalized();origin=point.copy();hits=0
        epsilon=max(2e-5,tolerance*scale*2)
        for _ in range(128):
            hit=tree.ray_cast(origin,direction,distance)[0]
            if hit is None:break
            hits+=1;origin=hit+direction*epsilon
        return bool(hits%2)
    def solid_overlap(first,second):
        if trees[first.name].overlap(trees[second.name]):return True
        epsilon=max(.0002,tolerance*scale*4)
        for candidate,other in ((first,second),(second,first)):
            vertices,triangles,_=geometry(candidate)
            low,high=boxes[candidate.name];ol,oh=boxes[other.name]
            distance=max(1.,math.dist(low,high)+math.dist(ol,oh))*2
            stride=max(1,len(triangles)//32)
            for indices in triangles[::stride]:
                a,b,c=(vertices[index] for index in indices)
                normal=(b-a).cross(c-a)
                if normal.length<1e-10:continue
                normal.normalize();center=(a+b+c)/3
                for sign in (-1,1):
                    probe=center+normal*(epsilon*sign)
                    if interior(probe,trees[candidate.name],distance) and interior(probe,trees[other.name],distance):return True
        return False
    for index,obj in enumerate(collision_objects):
        if obj.name not in boxes:
            continue
        low,high=boxes[obj.name]
        for other in collision_objects[:index]:
            if obj.get('source_market_id') == other.get('source_market_id') or other.name not in boxes:
                continue
            other_low,other_high=boxes[other.name]
            if any(high[i] < other_low[i] or other_high[i] < low[i] for i in range(3)):
                continue
            if solid_overlap(obj,other):
                conflicts.append({'objects':[obj.name,other.name],
                                  'markets':[obj.get('source_market_id'),other.get('source_market_id')]})
    check(not conflicts,'Actual contents of different markets intersect: '+str(conflicts[:8]))
    if conflicts:
        implicated={str(mid) for conflict in conflicts for mid in conflict['markets']}
        for row in rows:
            if row['id'] in implicated:
                row['passed']=False
    fortification_conflicts=[]
    for obj in structure_targets:
        if obj.name not in boxes:continue
        low,high=boxes[obj.name]
        for other in fortifications.values():
            if obj is other or other.name not in boxes:continue
            other_low,other_high=boxes[other.name]
            if any(high[i]<other_low[i] or other_high[i]<low[i] for i in range(3)):continue
            if solid_overlap(obj,other):
                fortification_conflicts.append({'object':obj.name,'marketId':obj.get('source_market_id',next(iter(expected),None)),
                                                'fortification':other.name})
    check(not fortification_conflicts,'Actual market contents intersect city or castle fortifications: '+str(fortification_conflicts[:12]))
    if fortification_conflicts:
        implicated={str(row['marketId']) for row in fortification_conflicts}
        for row in rows:
            if row['id'] in implicated:row['passed']=False
    return {'enabled':bool(expected),'version':1,'passed':not failures,'legacySingleMarket':not modern,
            'checkedMarkets':len(rows),'plazas':rows,'features':feature_checks,'crossMarketConflicts':conflicts,
            'fortificationConflicts':fortification_conflicts,'checkedFortificationObjects':len(fortifications),
            'failures':failures,
            'method':'Source market districts compared with saved ground meshes, final source-owned contents, cross-market and actual fortification mesh collisions.'}
