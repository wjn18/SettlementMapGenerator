"""Photograph the actual saved cabins at their berths without editing the scene."""
import argparse,sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from render_pipeline import render_with_ink

parser=argparse.ArgumentParser()
parser.add_argument('--blend',type=Path,required=True)
parser.add_argument('--output-dir',type=Path,required=True)
opts=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
opts.output_dir.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(opts.blend.resolve()))
scene=bpy.context.scene;camera=scene.camera
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
    for device in prefs.devices:device.use=device.type!='CPU'
    scene.cycles.device='GPU'
except Exception:pass
scene.cycles.samples=32;scene.render.resolution_x=1600;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
for line in scene.view_layers[0].freestyle_settings.linesets:
    line.linestyle.thickness=.6 if line.name=='Fine structural seams' else 1.1
variants={}
for obj in scene.objects:
    if obj.get('asset_mount_role')=='harbor_boat':variants.setdefault(obj['authored_asset_id'],obj)
for aid,boat in variants.items():
    focus=boat.matrix_world@Vector((0,0,1))
    camera.location=boat.matrix_world@Vector((9,18,30));camera.rotation_euler=(focus-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.ortho_scale={'harbor_rowboat_01':8.7,'harbor_fishing_boat_01':13,'harbor_merchant_ship_01':20,'harbor_river_cargo_01':16,'harbor_cargo_sloop_01':18,'harbor_cargo_ketch_01':20,'harbor_cargo_lugger_01':18}[aid]*boat.matrix_world.to_scale().x
    bpy.context.view_layer.update()
    c=boat.matrix_world.translation;radius=camera.data.ortho_scale
    visible=[]
    for obj in scene.objects:
        if obj.type!='MESH' or obj.name=='Study_ground' or obj.get('environment_extent'):visible.append(obj);continue
        bounds=[obj.matrix_world@Vector(v) for v in obj.bound_box]
        if max(p.x for p in bounds)>=c.x-radius and min(p.x for p in bounds)<=c.x+radius and max(p.y for p in bounds)>=c.y-radius and min(p.y for p in bounds)<=c.y+radius:visible.append(obj)
    scene.render.filepath=str(opts.output_dir/(aid+'-cabin.png'))
    render_with_ink(scene,visible)
    print('CABIN_VIEW_READY '+aid,flush=True)
