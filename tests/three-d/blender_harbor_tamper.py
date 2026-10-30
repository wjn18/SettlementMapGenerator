"""Prove saved-mesh verification rejects actual coastal geometry corruption."""
import sys,json,argparse
from pathlib import Path
import bpy, bmesh
from mathutils import Vector
root=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'experiments'/'3d-sample'))
from verify_harbor import verify_harbor
parser=argparse.ArgumentParser();parser.add_argument('--artifact-dir',type=Path,default=root/'artifacts'/'harbor-tests'/'east')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
out=args.artifact_dir.resolve()
bpy.ops.wm.open_mainfile(filepath=str(out/'scene.blend'))
selection=json.loads((out/'selection.json').read_text(encoding='utf-8'))
manifest=json.loads((out/'scene-manifest.json').read_text(encoding='utf-8'))
scale=manifest['horizontalScale']
assert verify_harbor(selection,manifest,scale)['passed']
checks=[]
underpass=next((o for o in bpy.context.scene.objects if o.get('asset_mount_role')=='harbor_quay_underpass'),None)
if underpass:
    original=underpass.matrix_world.copy();underpass.location.z+=.4;bpy.context.view_layer.update()
    report=verify_harbor(selection,manifest,scale)
    assert not report['passed'] and any('walking surface' in f for f in report['failures'])
    checks.append({'kind':'blocked_dock_walkway','rejected':True,'failures':report['failures']});underpass.matrix_world=original
sea=bpy.data.objects['Harbor_sea_surface'];original_sea=sea.data
variants={o.get('authored_asset_id'):o for o in bpy.context.scene.objects if o.get('asset_mount_role')=='harbor_boat'}
for aid,boat in variants.items():
    # Restore a small piece of sea at the cabin center. Bounds, waterline,
    # boat position and shoreline all remain correct: only the cabin floods.
    damaged=original_sea.copy();sea.data=damaged
    bm=bmesh.new();bm.from_mesh(damaged)
    p=boat.matrix_world.translation
    vertices=[bm.verts.new((p.x+x,p.y+y,p.z)) for x,y in ((-.25,-.25),(.25,-.25),(0,.25))]
    bm.faces.new(vertices);bm.to_mesh(damaged);bm.free()
    report=verify_harbor(selection,manifest,scale)
    assert not report['passed'] and any('water enters the cabin' in f for f in report['failures']),aid+' flooded cabin was accepted'
    checks.append({'kind':'flooded_cabin','assetId':aid,'rejected':True,'failures':report['failures']})
    sea.data=original_sea;bpy.data.meshes.remove(damaged)
for role,object_name in [('sea','Harbor_sea_surface'),('dock','Harbor_dock_dock0_0')]:
    obj=bpy.data.objects[object_name];original=obj.data.vertices[0].co.copy()
    obj.data.vertices[0].co.x+=5
    report=verify_harbor(selection,manifest,scale)
    assert not report['passed'],role+' corruption was accepted'
    checks.append({'kind':role,'rejected':True,'failures':report['failures']})
    obj.data.vertices[0].co=original
boat=next(o for o in bpy.context.scene.objects if o.get('asset_mount_role')=='harbor_boat')
original=boat.matrix_world.copy();boat.location.x-=200;bpy.context.view_layer.update()
report=verify_harbor(selection,manifest,scale);assert not report['passed']
checks.append({'kind':'boat_ashore','rejected':True,'failures':report['failures']});boat.matrix_world=original
warehouse=next(o for o in bpy.context.scene.objects if o.get('asset_mount_role')=='harbor_warehouse_door')
original=warehouse.matrix_world.copy();warehouse.location.z+=10;bpy.context.view_layer.update()
report=verify_harbor(selection,manifest,scale);assert not report['passed']
checks.append({'kind':'warehouse_above_roof','rejected':True,'failures':report['failures']});warehouse.matrix_world=original
(out.parent/'tamper-verification.json').write_text(json.dumps({'passed':True,'checks':checks},indent=2),encoding='utf-8')
print('PASS coastal geometry and three vessel cabin-flooding corruption checks')
