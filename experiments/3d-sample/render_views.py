"""Render only requested views from a verified scene; never resave its geometry."""
import argparse
import json
import sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from render_pipeline import render_with_ink, RenderBrightnessError

parser=argparse.ArgumentParser()
parser.add_argument('--blend',type=Path,required=True)
parser.add_argument('--artifact-dir',type=Path,required=True)
parser.add_argument('--view',action='append',choices=['center','full','castle'])
parser.add_argument('--resolution',type=int,default=3200)
parser.add_argument('--preview',action='store_true')
opts=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
out=opts.artifact_dir.resolve();out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(opts.blend.resolve()))
scene=bpy.context.scene;camera=scene.camera
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
bpy.context.view_layer.update()
base_matrix=camera.matrix_world.copy();base_scale=camera.data.ortho_scale
meshes=[o for o in scene.objects if o.type=='MESH']
manifest=json.loads((out/'scene-manifest.json').read_text(encoding='utf-8'))
selection=json.loads((out/'selection.json').read_text(encoding='utf-8'))
reports=[]
for view in opts.view or ['center']:
    camera.matrix_world=base_matrix;camera.data.ortho_scale=base_scale
    visible=None
    resolution=1500 if opts.preview else opts.resolution
    scene.cycles.samples=24 if opts.preview else (48 if view=='center' else 64)
    scene.render.resolution_x=scene.render.resolution_y=resolution
    if view=='center':
        walls=bpy.data.collections.get('02_CITY_WALL')
        framing_objects=list(walls.all_objects) if walls else []
        framing_objects.extend(obj for obj in meshes if obj.get('asset_kind')=='market_plaza')
        if manifest.get('harbor',{}).get('enabled'):
            city_ids={b['id'] for b in selection['buildings'] if b.get('wardType')!='Farm'}
            framing_objects.extend(o for o in meshes if o.get('source_building_id') in city_ids or o.get('asset_mount_role') in ('harbor_boat','harbor_deck','harbor_quay','harbor_warehouse_door') or o.get('asset_kind')=='exact_dock_base')
        if manifest.get('river',{}).get('enabled'):
            city_ids={b['id'] for b in selection['buildings'] if b.get('wardType')!='Farm'}
            framing_objects.extend(o for o in meshes if o.get('source_building_id') in city_ids or o.get('source_bridge_id'))
        if framing_objects:
            inv=camera.matrix_world.inverted()
            # River + harbor framing shares most buildings. Stream unique
            # objects instead of retaining millions of duplicate Vectors
            # throughout all three render passes.
            lo=[float('inf'),float('inf')];hi=[float('-inf'),float('-inf')]
            for obj in dict.fromkeys(framing_objects):
                if obj.type!='MESH':continue
                for v in obj.data.vertices:
                    p=inv@(obj.matrix_world@v.co)
                    lo[0]=min(lo[0],p.x);lo[1]=min(lo[1],p.y)
                    hi[0]=max(hi[0],p.x);hi[1]=max(hi[1],p.y)
            camera.location+=camera.matrix_world.to_3x3()@Vector(((lo[0]+hi[0])/2,(lo[1]+hi[1])/2,0))
            camera.data.ortho_scale=max(hi[0]-lo[0],hi[1]-lo[1])*1.12
    elif view=='castle':
        points=[Vector((p['x']*manifest['horizontalScale'],p['y']*manifest['horizontalScale'],z))
                for wall in selection['walls'] if wall['kind']=='castle' for p in wall['points'] for z in (0,22)]
        if not points:raise ValueError('The source town has no castle view.')
        castle_ids={r['id'] for r in manifest['buildings'] if r.get('wardType')=='Castle'}
        bounds={o.name:[o.matrix_world@Vector(p) for p in o.bound_box] for o in meshes}
        points.extend(p for o in meshes if o.get('source_building_id') in castle_ids for p in bounds[o.name])
        lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)]
        visible=[o for o in scene.objects if o.type!='MESH' or o.name=='Study_ground' or not (
            max(p.x for p in bounds[o.name])<lo[0]-10 or min(p.x for p in bounds[o.name])>hi[0]+10
            or max(p.y for p in bounds[o.name])<lo[1]-10 or min(p.y for p in bounds[o.name])>hi[1]+10)]
        focus=Vector(tuple((a+b)/2 for a,b in zip(lo,hi)))
        direction=camera.matrix_world.to_quaternion()@Vector((0,0,1))
        camera.location=focus+direction*550
        bpy.context.view_layer.update();projected=[camera.matrix_world.inverted()@p for p in points]
        px=[min(p.x for p in projected),max(p.x for p in projected)];py=[min(p.y for p in projected),max(p.y for p in projected)]
        camera.location+=camera.matrix_world.to_3x3()@Vector(((px[0]+px[1])/2,(py[0]+py[1])/2,0))
        camera.data.ortho_scale=max(px[1]-px[0],(py[1]-py[0])*1.2)*1.12
        resolution=1600 if opts.preview else 2200
        scene.render.resolution_x=resolution;scene.render.resolution_y=round(resolution/1.2)
        scene.cycles.samples=32
    scene.render.resolution_percentage=100
    if opts.preview:
        for line in scene.view_layers[0].freestyle_settings.linesets:line.linestyle.thickness=.55 if line.name=='Fine structural seams' else 1.05
    else:
        for line in scene.view_layers[0].freestyle_settings.linesets:line.linestyle.thickness=1.15 if line.name=='Fine structural seams' else 2.25
    # A reused scene may have been built at the other quality. Normalize all
    # quality-dependent stroke settings, not only samples and line width.
    for line in scene.view_layers[0].freestyle_settings.linesets:
        for modifier in line.linestyle.geometry_modifiers:
            if modifier.type=='SPATIAL_NOISE':modifier.amplitude=.25 if opts.preview else .55
    filename={'full':'scene-render.png','center':'city-center-render.png','castle':'castle-wall-detail.png'}[view]
    scene.render.filepath=str(out/filename)
    try:
        report=render_with_ink(scene,visible)
    except RenderBrightnessError:
        if scene.cycles.device != 'GPU':raise
        print('RENDER_BRIGHTNESS_RETRY CPU '+view,flush=True)
        scene.cycles.device='CPU'
        report=render_with_ink(scene,visible)
        report['brightnessRetry']='CPU'
    reports.append({'view':view,'file':filename,
        'lineNoiseAmplitude':.25 if opts.preview else .55,'cameraPosition':list(camera.location),'orthoScale':camera.data.ortho_scale,**report})
    print('VIEW_READY '+view,flush=True)
(out/'render-timing.json').write_text(json.dumps(reports,indent=2),encoding='utf-8')
