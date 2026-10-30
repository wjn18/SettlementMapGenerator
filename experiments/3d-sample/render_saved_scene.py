"""Render an already verified scene, without rebuilding the city."""
import argparse,sys
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parent))
from render_pipeline import render_with_ink

parser=argparse.ArgumentParser()
parser.add_argument('--blend',required=True,type=Path)
parser.add_argument('--output',required=True,type=Path)
parser.add_argument('--resolution',type=int,default=3200)
parser.add_argument('--preview',action='store_true')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
bpy.ops.wm.open_mainfile(filepath=str(args.blend.resolve()))
scene=bpy.context.scene
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences
    for backend in ('OPTIX','CUDA'):
        try:
            prefs.compute_device_type=backend;prefs.get_devices()
            if any(d.type!='CPU' for d in prefs.devices):
                for d in prefs.devices:d.use=d.type!='CPU'
                scene.cycles.device='GPU';break
        except Exception:pass
except Exception:pass
scene.render.resolution_x=scene.render.resolution_y=1500 if args.preview else args.resolution
scene.render.resolution_percentage=100;scene.cycles.samples=24 if args.preview else 64
scene.render.filepath=str(args.output.resolve())
if args.preview:
    for line in scene.view_layers[0].freestyle_settings.linesets:line.linestyle.thickness=.55 if line.name=='Fine structural seams' else 1.05
render_with_ink(scene)
print('VERIFIED_SCENE_RENDERED',flush=True)
