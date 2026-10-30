"""Render tower, quay crossing and tangent-road details from the saved city."""
import argparse,sys,json,math
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from render_pipeline import render_with_ink

parser=argparse.ArgumentParser();parser.add_argument('--artifact-dir',type=Path,required=True);parser.add_argument('--output-dir',type=Path,required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
bpy.ops.wm.open_mainfile(filepath=str((args.artifact_dir/'scene.blend').resolve()))
selection=json.loads((args.artifact_dir/'selection.json').read_text(encoding='utf-8'));manifest=json.loads((args.artifact_dir/'scene-manifest.json').read_text(encoding='utf-8'));scale=manifest['horizontalScale']
args.output_dir.mkdir(parents=True,exist_ok=True);scene=bpy.context.scene;camera=scene.camera
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
    for device in prefs.devices:device.use=device.type!='CPU'
    scene.cycles.device='GPU'
except Exception:pass
scene.cycles.samples=32;scene.render.resolution_x=1600;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
for line in scene.view_layers[0].freestyle_settings.linesets:line.linestyle.thickness=.55 if line.name=='Fine structural seams' else 1.1
views=[]
castle=next((w for w in selection['walls'] if w['kind']=='castle'),None)
if castle and castle.get('renderTowerPoints'):
    p=castle['renderTowerPoints'][0];views.append(('castle-tower-spacing',(p['x']*scale,p['y']*scale,6),42,(-35,-45,65)))
for dock in manifest.get('harbor',{}).get('docks',[])[:1]:
    row=next(d for d in selection['terrain']['docks'] if d['id']==dock['id']);a,b=row['points'][:2]
    shore=selection['terrain']['coast']['shoreline']
    for c,d in zip(shore,shore[1:]):
        dx,dy=b['x']-a['x'],b['y']-a['y'];ex,ey=d['x']-c['x'],d['y']-c['y'];det=dx*ey-dy*ex
        if abs(det)<1e-9:continue
        t=((c['x']-a['x'])*ey-(c['y']-a['y'])*ex)/det;s=((c['x']-a['x'])*dy-(c['y']-a['y'])*dx)/det
        if 0<=t<=1 and 0<=s<=1:
            views.append(('flush-dock-crossing',((a['x']+dx*t)*scale,(a['y']+dy*t)*scale,0),16,(-25,-30,40)));break
groups=[]
for road in selection['roads']:
    ps=road['points'];group=[];amount=0
    for i in range(1,len(ps)-1):
        a,p,b=ps[i-1:i+2];u=(p['x']-a['x'],p['y']-a['y']);v=(b['x']-p['x'],b['y']-p['y'])
        angle=math.acos(max(-1,min(1,(u[0]*v[0]+u[1]*v[1])/math.hypot(*u)/math.hypot(*v))))
        if math.radians(.1)<angle<math.radians(15):group.append(p);amount+=angle
        else:
            if len(group)>3:groups.append((amount,list(group),road['width']))
            group=[];amount=0
    if len(group)>3:groups.append((amount,group,road['width']))
if groups:
    _,points,width=max(groups,key=lambda item:item[0]);x=sum(p['x'] for p in points)/len(points)*scale;y=sum(p['y'] for p in points)/len(points)*scale
    span=max(max(p['x'] for p in points)-min(p['x'] for p in points),max(p['y'] for p in points)-min(p['y'] for p in points))*scale
    views.append(('tangent-road-transition',(x,y,.1),max(32,span+width*scale*2.2),(0,-7,65)))
for name,focus,size,offset in views:
    focus=Vector(focus);camera.location=focus+Vector(offset);camera.rotation_euler=(focus-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=size
    bpy.context.view_layer.update();visible=[]
    for obj in scene.objects:
        if obj.type!='MESH' or obj.name=='Study_ground' or obj.get('environment_extent'):visible.append(obj);continue
        bounds=[obj.matrix_world@Vector(p) for p in obj.bound_box]
        if max(p.x for p in bounds)>=focus.x-size and min(p.x for p in bounds)<=focus.x+size and max(p.y for p in bounds)>=focus.y-size and min(p.y for p in bounds)<=focus.y+size:visible.append(obj)
    scene.render.filepath=str(args.output_dir/(name+'.png'));render_with_ink(scene,visible);print('DETAIL_READY '+name,flush=True)
