"""Require real saved-river mesh corruption to fail independent verification."""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'experiments'/'3d-sample'))
from verify_river import verify_river

parser = argparse.ArgumentParser()
parser.add_argument('--artifact-dir', type=Path, default=ROOT/'artifacts'/'3d-river-town')
parser.add_argument('--blend', type=Path)
parser.add_argument('--bridge-id', help='Source bridge ID to corrupt; defaults to the first source bridge.')
parser.add_argument('--report-name', default='river-tamper-verification.json', help='Simple JSON filename within the artifact directory.')
opts = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*\.json', opts.report_name):
    parser.error('--report-name must be a simple basename ending in .json.')
out = opts.artifact_dir.resolve()
blend = opts.blend.resolve() if opts.blend else out/'scene.blend'
selection = json.loads((out/'selection.json').read_text(encoding='utf-8-sig'))
source = json.loads((out/'source-town.json').read_text(encoding='utf-8-sig'))
manifest = json.loads((out/'scene-manifest.json').read_text(encoding='utf-8-sig'))
scale = manifest['horizontalScale']
source_bridges = source.get('river', {}).get('bridges', [])
if not source_bridges:
    parser.error('The source river contains no bridge to corrupt.')
bridge_id = opts.bridge_id or source_bridges[0]['id']
matching_bridges = [bridge for bridge in source_bridges if bridge['id'] == bridge_id]
if len(matching_bridges) != 1:
    parser.error('--bridge-id must identify exactly one source bridge: '+str(bridge_id))
selected_bridge = matching_bridges[0]


def reload_scene():
    bpy.ops.wm.open_mainfile(filepath=str(blend))


def verify():
    bpy.context.view_layer.update()
    return verify_river(selection, manifest, scale, source=source)


def bridge_road():
    bridge = selected_bridge
    return bridge, bpy.data.objects['Original_road_'+bridge['roadId']]


def narrow_bridge():
    bridge, obj = bridge_road()
    a, b = bridge['points'][0], bridge['points'][-1]
    along = Vector((b['x']-a['x'], b['y']-a['y'])).normalized()
    normal = Vector((-along.y, along.x))
    center = Vector(((a['x']+b['x'])*scale/2, (a['y']+b['y'])*scale/2))
    inverse = obj.matrix_world.inverted()
    for vertex in obj.data.vertices:
        point = obj.matrix_world@vertex.co
        cross = (Vector((point.x, point.y))-center).dot(normal)
        point.x -= normal.x*cross*.65
        point.y -= normal.y*cross*.65
        vertex.co = inverse@point
    obj.data.update()


def move_bridge():
    _, obj = bridge_road()
    obj.location.x += 3.0


def raise_water():
    bpy.data.objects['River_water_surface'].location.z += .5


def cover_river():
    points = [(p['x']*scale, p['y']*scale, 0) for p in selection['cropPolygon']]
    mesh = bpy.data.meshes.new('Tamper_ground_over_river')
    mesh.from_pydata(points, [], [tuple(range(len(points)))])
    mesh.update()
    obj = bpy.data.objects.new('Tamper_ground_over_river', mesh)
    bpy.data.collections['00_GROUND'].objects.link(obj)


def block_bridge():
    bridge, _ = bridge_road()
    a, b = bridge['points'][0], bridge['points'][-1]
    along = Vector((b['x']-a['x'], b['y']-a['y'])).normalized()
    center = (a['x']*scale+along.x*.3, a['y']*scale+along.y*.3, 1.0)
    bpy.ops.mesh.primitive_cube_add(size=2, location=center)
    obj = bpy.context.object
    obj.name = 'Tamper_bridge_head_coping'
    obj.scale = (bridge['width']*scale, bridge['width']*scale, .65)


def remove_bank_bottom():
    for name in manifest['river'].get('bankObjects', []):
        obj = bpy.data.objects[name]
        minimum = min((obj.matrix_world@v.co).z for v in obj.data.vertices)
        bottom = next((face for face in obj.data.polygons
                       if all(abs((obj.matrix_world@obj.data.vertices[i].co).z-minimum) < 1e-5
                              for i in face.vertices)), None)
        if bottom is None:
            continue
        index = bottom.index
        damaged = obj.data.copy()
        obj.data = damaged
        bm = bmesh.new()
        bm.from_mesh(damaged)
        bm.faces.ensure_lookup_table()
        bm.faces.remove(bm.faces[index])
        bm.to_mesh(damaged)
        bm.free()
        damaged.update()
        return
    raise AssertionError('The sample must contain a real bank bottom face for the open-shell tamper test.')


def detach_abutment():
    bridge, _ = bridge_road()
    a, b = bridge['points'][0], bridge['points'][-1]
    endpoint = Vector((a['x']*scale, a['y']*scale, 0))
    along = Vector((b['x']-a['x'], b['y']-a['y'], 0)).normalized()
    candidates = [o for o in bpy.context.scene.objects
                  if o.get('source_bridge_id') == bridge['id'] and o.get('asset_mount_role') == 'bridge_abutment']
    obj = min(candidates, key=lambda o: (o.matrix_world.translation-endpoint).length)
    obj.location -= along*3


reload_scene()
baseline = verify()
if not baseline['passed']:
    raise AssertionError('Baseline river must pass before tamper tests: '+json.dumps(baseline['failures']))
cases = [
    ('narrowed_bridge', narrow_bridge, 'walking surface'),
    ('moved_bridge_head', move_bridge, 'walking surface'),
    ('raised_water', raise_water, 'water coverage or level'),
    ('ground_over_river', cover_river, 'covers the planned river'),
    ('blocked_bridge_clearance', block_bridge, 'blocks the bridge walking clearance'),
    ('removed_bank_bottom', remove_bank_bottom, 'river bank shell'),
    ('detached_bridge_abutment', detach_abutment, 'abutment bearing'),
]
checks = []
for name, mutate, expected_failure in cases:
    reload_scene()
    mutate()
    report = verify()
    rejected = not report['passed'] and any(expected_failure in f for f in report['failures'])
    checks.append({'kind': name, 'rejected': rejected, 'failures': report['failures']})
    if not rejected:
        raise AssertionError(name+' corruption was accepted or rejected for an unrelated reason: '+json.dumps(report['failures']))
result = {'passed': True, 'baselinePassed': True, 'scene': str(blend), 'bridgeId': bridge_id,
          'sourceFilesSha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                                for p in (blend, out/'source-town.json', out/'selection.json', out/'scene-manifest.json')},
          'checks': checks}
(out/opts.report_name).write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print('PASS river saved-mesh corruption checks for '+bridge_id+': '+', '.join(c['kind'] for c in checks))
