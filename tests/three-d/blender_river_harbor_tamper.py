"""Corrupt in-memory copies only; saved user scenes are never modified."""
import sys,json,argparse
from pathlib import Path
import bpy,bmesh
from mathutils import Vector
root=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'experiments'/'3d-sample'))
from verify_harbor import verify_harbor
from verify_river import verify_river
from verify_estuary import verify_estuary
parser=argparse.ArgumentParser();parser.add_argument('--artifact-dir',type=Path,default=root/'artifacts/3d-river-harbor')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
out=args.artifact_dir.resolve();bpy.ops.wm.open_mainfile(filepath=str(out/'scene.blend'))
source=json.loads((out/'source-town.json').read_text(encoding='utf-8'))
selection=json.loads((out/'selection.json').read_text(encoding='utf-8'))
manifest=json.loads((out/'scene-manifest.json').read_text(encoding='utf-8'));scale=manifest['horizontalScale'];rows=[]
def verify():
    bpy.context.view_layer.update()
    reports=[verify_harbor(selection,manifest,scale),verify_river(selection,manifest,scale,source),verify_estuary(selection,manifest,scale,source)]
    return [message for report in reports for message in report.get('failures',[])]
assert not verify()
def rejected(name):
    errors=verify();assert errors,name+' corruption was accepted'
    rows.append({'kind':name,'rejected':True,'failures':errors});print('REJECTED',name,flush=True)
boat=next(o for o in bpy.context.scene.objects if o.get('asset_mount_role')=='harbor_boat' and o.get('source_waterbody')=='river')
original=boat.matrix_world.copy();boat.location.x+=100;rejected('vessel_ashore');boat.matrix_world=original
for sailboat in [o for o in bpy.context.scene.objects if o.get('asset_mount_role')=='harbor_boat' and o.get('source_waterbody')=='river' and o.get('authored_asset_id','').startswith('harbor_cargo_')]:
    aid=sailboat['authored_asset_id'];sailboat['authored_asset_id']='harbor_river_cargo_01';rejected('wrong_sailing_cargo_asset');sailboat['authored_asset_id']=aid
    collections=list(sailboat.users_collection)
    for collection in collections:collection.objects.unlink(sailboat)
    rejected('missing_sailing_cargo_vessel')
    for collection in collections:collection.objects.link(sailboat)
boat.location.z-=2;rejected('cargo_hull_below_bed');boat.matrix_world=original
bridge=selection['river']['bridges'][0]['points'];boat.location=Vector((sum(p['x'] for p in bridge)/len(bridge)*scale,sum(p['y'] for p in bridge)/len(bridge)*scale,-1.15));rejected('vessel_in_bridge');boat.matrix_world=original
dock=next(o for o in bpy.context.scene.objects if o.get('asset_kind')=='exact_dock_base' and o.get('source_waterbody')=='river')
original_point=dock.data.vertices[0].co.copy();dock.data.vertices[0].co.x+=3;rejected('detached_dock');dock.data.vertices[0].co=original_point
water=bpy.data.objects['River_water_surface'];original_mesh=water.data
water.data=original_mesh.copy();bm=bmesh.new();bm.from_mesh(water.data)
largest=max(bm.faces,key=lambda f:f.calc_area());bmesh.ops.delete(bm,geom=[largest],context='FACES');bm.to_mesh(water.data);bm.free()
rejected('missing_river_water');damaged=water.data;water.data=original_mesh;bpy.data.meshes.remove(damaged)
water.data=original_mesh.copy();bm=bmesh.new();bm.from_mesh(water.data);p=boat.matrix_world.translation
vv=[bm.verts.new((p.x+x,p.y+y,-1.15)) for x,y in ((-.2,-.2),(.2,-.2),(0,.2))];bm.faces.new(vv);bm.to_mesh(water.data);bm.free()
rejected('flooded_cabin');damaged=water.data;water.data=original_mesh;bpy.data.meshes.remove(damaged)
assert not verify()
(out/'river-harbor-tamper.json').write_text(json.dumps({'passed':True,'checks':rows},indent=2),encoding='utf-8')
print('PASS river harbor tamper checks',flush=True)
