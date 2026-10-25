"""Supplementary city-wall framing; never modifies the saved complete scene."""
import argparse
import json
import sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))

parser=argparse.ArgumentParser()
parser.add_argument('--artifact-dir',type=Path,required=True)
parser.add_argument('--name',default='minimal-city')
parser.add_argument('--resolution',type=int,default=2800)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
out=args.artifact_dir.resolve()
bpy.ops.wm.open_mainfile(filepath=str(out/(args.name+'.blend')))
scene=bpy.context.scene
prefs=bpy.context.preferences.addons['cycles'].preferences
for backend in ('OPTIX','CUDA'):
    try:
        prefs.compute_device_type=backend;prefs.get_devices()
        if any(d.type!='CPU' for d in prefs.devices):
            for dev in prefs.devices: dev.use=dev.type!='CPU'
            scene.cycles.device='GPU';break
    except Exception:pass
wall=bpy.data.collections.get('02_CITY_WALL')
if not wall or not wall.all_objects:
    print('No city wall: skipping optional city-center framing.');sys.exit(0)
camera=scene.camera
bpy.context.view_layer.update()
inv=camera.matrix_world.inverted()
coords=[inv@(obj.matrix_world@v.co) for obj in wall.all_objects if obj.type=='MESH' for v in obj.data.vertices]
minx,maxx=min(p.x for p in coords),max(p.x for p in coords)
miny,maxy=min(p.y for p in coords),max(p.y for p in coords)
camera.location+=camera.matrix_world.to_3x3()@Vector(((minx+maxx)/2,(miny+maxy)/2,0))
camera.data.ortho_scale=max(maxx-minx,maxy-miny)*1.12
scene.render.resolution_x=args.resolution;scene.render.resolution_y=args.resolution
scene.cycles.samples=48
scene.render.filepath=str(out/'city-center-render.png')
(out/'city-center-camera.json').write_text(json.dumps({'note':'Supplementary framing of the original complete scene. Rural buildings remain in the saved scene and full overview.',
    'location':list(camera.location),'orthoScale':camera.data.ortho_scale,'resolution':[args.resolution,args.resolution]},indent=2),encoding='utf-8')
from render_pipeline import render_with_ink
render_with_ink(scene)
print('CITY CENTER FINISHED',flush=True)
