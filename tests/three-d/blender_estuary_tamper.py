"""Reject actual saved estuary corruptions without changing the saved scene."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'experiments/3d-sample'))
from verify_estuary import verify_estuary, mouth_segments
from verify_river import verify_river
from verify_harbor import verify_harbor

parser = argparse.ArgumentParser()
parser.add_argument('--artifact-dir', type=Path, default=ROOT/'artifacts/3d-estuary-town')
parser.add_argument('--blend', type=Path)
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
out = args.artifact_dir.resolve()
blend = args.blend.resolve() if args.blend else out/'scene.blend'
selection = json.loads((out/'selection.json').read_text(encoding='utf-8-sig'))
source = json.loads((out/'source-town.json').read_text(encoding='utf-8-sig'))
manifest = json.loads((out/'scene-manifest.json').read_text(encoding='utf-8-sig'))
scale = manifest['horizontalScale']


def reload_scene():
    bpy.ops.wm.open_mainfile(filepath=str(blend))


def verify():
    bpy.context.view_layer.update()
    results = {
        'estuary': verify_estuary(selection, manifest, scale, source=source),
        'river': verify_river(selection, manifest, scale, source=source),
        'harbor': verify_harbor(selection, manifest, scale),
    }
    return {'passed': all(report['passed'] for report in results.values()),
            'failures': [failure for report in results.values() for failure in report['failures']],
            'reports': results}


def source_surface_in_sea():
    obj = bpy.data.objects['River_water_surface']
    data = bpy.data.meshes.new('Tamper_uncut_source_river')
    points = [(p['x']*scale, p['y']*scale, -1.15) for p in source['river']['surface']]
    data.from_pydata(points, [], [tuple(range(len(points)))])
    data.update()
    obj.data = data


def raise_sea():
    bpy.data.objects['Harbor_sea_surface'].location.z += .3


def delete_river_water():
    bpy.data.objects.remove(bpy.data.objects['River_water_surface'], do_unlink=True)


def ground_over_mouth():
    points = [(p['x']*scale, p['y']*scale, 0) for p in selection['cropPolygon']]
    data = bpy.data.meshes.new('Tamper_estuary_floor')
    data.from_pydata(points, [], [tuple(range(len(points)))])
    data.update()
    obj = bpy.data.objects.new('Tamper_estuary_floor', data)
    bpy.data.collections['00_GROUND'].objects.link(obj)


def blocked_mouth():
    coast = source['terrain']['coast']
    rows = mouth_segments(coast['shoreline'], source['river']['surface'], scale)
    row = max(rows, key=lambda item: math.dist(*item['points']))
    a, b = row['points']
    length = math.dist(a, b)
    bpy.ops.mesh.primitive_cube_add(size=2, location=((a[0]+b[0])/2, (a[1]+b[1])/2, -.6))
    obj = bpy.context.object
    obj.name = 'Tamper_retaining_wall_across_mouth'
    obj.rotation_euler.z = math.atan2(b[1]-a[1], b[0]-a[0])
    obj.scale = (length*.55, .4, 1.4)
    obj['asset_mount_role'] = 'harbor_quay'


def shifted_bridge_head():
    bridge = source['river']['bridges'][0]
    bpy.data.objects['Original_road_'+bridge['roadId']].location.x += 3


def flood_boat_with_river_layer():
    boats = [obj for obj in bpy.context.scene.objects if obj.get('asset_mount_role') == 'harbor_boat']
    if not boats:
        raise AssertionError('The estuary port sample needs a boat for the all-water-layer cabin test.')
    boat = boats[0]
    center = boat.matrix_world.translation
    points = [(center.x+x, center.y+y, -1.142) for x,y in ((-2,-2),(2,-2),(2,2),(-2,2))]
    data = bpy.data.meshes.new('Tamper_river_shallow_in_cabin')
    data.from_pydata(points, [], [(0,1,2,3)])
    data.update()
    obj = bpy.data.objects.new('Tamper_river_shallow_in_cabin', data)
    bpy.context.scene.collection.objects.link(obj)
    obj['source_terrain_role'] = 'river_shallow'
    obj['water_level'] = -1.142


reload_scene()
baseline = verify()
if not baseline['passed']:
    raise AssertionError('Baseline estuary must pass: '+json.dumps(baseline['failures']))
cases = [
    ('overlapping_source_river_and_sea', source_surface_in_sea, 'source river minus sea'),
    ('raised_sea_level', raise_sea, 'water level'),
    ('missing_channel_surface', delete_river_water, 'water meshes'),
    ('ground_across_estuary', ground_over_mouth, 'covers the source estuary water'),
    ('retaining_wall_blocks_mouth', blocked_mouth, 'blocks the source river mouth'),
    ('detached_bridge_head', shifted_bridge_head, 'walking surface'),
]
if any(obj.get('asset_mount_role') == 'harbor_boat' for obj in bpy.context.scene.objects):
    cases.append(('river_layer_floods_cabin', flood_boat_with_river_layer, 'water enters the cabin'))
checks = []
for name, mutate, expected in cases:
    reload_scene()
    mutate()
    report = verify()
    rejected = not report['passed'] and any(expected in failure for failure in report['failures'])
    checks.append({'kind': name, 'rejected': rejected, 'failures': report['failures']})
    if not rejected:
        raise AssertionError(name+' was accepted or rejected for an unrelated reason: '+json.dumps(report['failures']))
result = {'passed': True, 'baselinePassed': True, 'scene': str(blend),
    'sourceFilesSha256': {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                         for path in (blend, out/'source-town.json', out/'selection.json', out/'scene-manifest.json')},
    'checks': checks}
(out/'estuary-tamper-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print('PASS estuary saved-mesh corruptions: '+', '.join(check['kind'] for check in checks))
