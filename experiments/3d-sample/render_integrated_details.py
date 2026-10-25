"""Focused photographs from the complete saved authored-assets scene."""
import argparse,json,sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from render_pipeline import render_with_ink

args=argparse.ArgumentParser()
args.add_argument('--artifact-dir',type=Path,required=True)
args.add_argument('--name',default='small-town-assets')
args.add_argument('--resolution',type=int,default=2000)
opts=args.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
out=opts.artifact_dir.resolve()
bpy.ops.wm.open_mainfile(filepath=str(out/(opts.name+'.blend')))
manifest=json.loads((out/'scene-manifest.json').read_text(encoding='utf-8'))
selection=json.loads((out/'selection.json').read_text(encoding='utf-8-sig'))
scene=bpy.context.scene;camera=scene.camera
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='OPTIX';prefs.get_devices()
    for d in prefs.devices:d.use=d.type!='CPU'
    scene.cycles.device='GPU'
except Exception:pass
bpy.context.view_layer.update()
meshes=[o for o in scene.objects if o.type=='MESH']
bounds={o.name:[o.matrix_world@Vector(p) for p in o.bound_box] for o in meshes}
views=[]
cathedrals={r['id'] for r in manifest['buildings'] if r.get('wardType')=='Cathedral'}
if cathedrals:
    points=[p for o in meshes if o.get('source_building_id') in cathedrals for p in bounds[o.name]]
    views.append(('cathedral-detail',points))
if selection.get('plaza'):
    poly=[(p['x']*manifest['horizontalScale'],p['y']*manifest['horizontalScale']) for p in selection['plaza']['points']]
    points=[Vector((x,y,z)) for x,y in poly for z in (.04,7.5)]
    views.append(('market-detail',points))
framing=[]
direction=camera.matrix_world.to_quaternion()@Vector((0,0,1))
for name,points in views:
    lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)]
    for obj in meshes:
        pts=bounds[obj.name]
        outside=max(p.x for p in pts)<lo[0]-10 or min(p.x for p in pts)>hi[0]+10 or max(p.y for p in pts)<lo[1]-10 or min(p.y for p in pts)>hi[1]+10
        obj.hide_render=outside and obj.name!='Study_ground'
    focus=Vector(tuple((a+b)/2 for a,b in zip(lo,hi)))
    camera.location=focus+direction*550
    bpy.context.view_layer.update();inv=camera.matrix_world.inverted();projected=[inv@p for p in points]
    px=[min(p.x for p in projected),max(p.x for p in projected)];py=[min(p.y for p in projected),max(p.y for p in projected)]
    camera.location+=camera.matrix_world.to_3x3()@Vector(((px[0]+px[1])/2,(py[0]+py[1])/2,0))
    camera.data.ortho_scale=max(px[1]-px[0],(py[1]-py[0])*1.2)*1.12
    scene.render.resolution_x=opts.resolution;scene.render.resolution_y=round(opts.resolution/1.2)
    scene.render.resolution_percentage=100;scene.cycles.samples=32
    scene.render.filepath=str(out/(name+'.png'))
    render_with_ink(scene)
    framing.append({'file':name+'.png','cameraPosition':list(camera.location),'orthoScale':camera.data.ortho_scale,
                    'note':'Photograph from the same complete scene; offscreen meshes hidden only in memory for rendering. Saved scene unchanged.'})
    print('INTEGRATED_DETAIL_READY '+name,flush=True)
(out/'detail-cameras.json').write_text(json.dumps(framing,indent=2),encoding='utf-8')
