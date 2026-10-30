"""Exercise actual saved arch meshes; never save the corrupted scene."""
import argparse, json, sys
from pathlib import Path
import bpy
from mathutils import Vector

root=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'experiments/3d-sample'))
from verify_river import verify_river

parser=argparse.ArgumentParser()
parser.add_argument('--artifact-dir',type=Path,required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
out=args.artifact_dir.resolve()
bpy.ops.wm.open_mainfile(filepath=str(out/'scene.blend'))
source=json.loads((out/'source-town.json').read_text(encoding='utf-8'))
selection=json.loads((out/'selection.json').read_text(encoding='utf-8'))
manifest=json.loads((out/'scene-manifest.json').read_text(encoding='utf-8'))
scale=manifest['horizontalScale'];rows=[]

def verify():
    bpy.context.view_layer.update()
    return verify_river(selection,manifest,scale,source)['failures']

def rejected(name):
    errors=verify()
    assert errors,name+' corruption was accepted'
    rows.append({'kind':name,'rejected':True,'failures':errors})
    print('REJECTED '+name,flush=True)

assert not verify()
bridge=selection['river']['bridges'][0]
road=bpy.data.objects['Original_road_'+bridge['roadId']]
original=road.data;road.data=original.copy()
for v in road.data.vertices:v.co.z=.035
rejected('flattened_arch_walkway')
damaged=road.data;road.data=original;bpy.data.meshes.remove(damaged)

road.data=original.copy()
a,b=[Vector((p['x']*scale,p['y']*scale,0)) for p in (bridge['points'][0],bridge['points'][-1])]
u=(b-a).normalized();normal=Vector((-u.y,u.x,0))
for v in road.data.vertices:v.co-=normal*(v.co-a).dot(normal)*.7
rejected('narrowed_arch_walkway')
damaged=road.data;road.data=original;bpy.data.meshes.remove(damaged)

abutment=next(o for o in bpy.context.scene.objects if o.get('source_bridge_id')==bridge['id'] and o.get('asset_mount_role')=='bridge_abutment')
position=abutment.location.copy();abutment.location.x+=50
rejected('missing_bank_bearing');abutment.location=position

bpy.ops.mesh.primitive_cube_add(size=1,location=(*((a+b)*.5)[:2],0))
blocker=bpy.context.object;blocker.name='Test_blocked_arch_opening';blocker.dimensions=(2,2,1)
rejected('blocked_arch_opening');bpy.data.objects.remove(blocker,do_unlink=True)

rail=next(o for o in bpy.context.scene.objects if o.get('source_bridge_id')==bridge['id'] and o.get('asset_mount_role')=='bridge_rail')
position=rail.location.copy()
center=sum((rail.matrix_world@v.co for v in rail.data.vertices),Vector())/len(rail.data.vertices)
rail.location-=normal*(center-a).dot(normal)
rejected('parapet_blocks_walking_lane');rail.location=position
assert not verify()
(out/'arch-bridge-tamper.json').write_text(json.dumps({'passed':True,'checks':rows},indent=2),encoding='utf-8')
print('PASS stone arch tamper checks',flush=True)
