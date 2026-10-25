"""Render category sheets from the saved library. Run in background Blender."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector

HERE=Path(__file__).resolve().parent
OUT=HERE.parents[1]/'artifacts'/'small-town-assets'
manifest=json.loads((OUT/'asset-library.json').read_text(encoding='utf-8'))
template=next(s for s in bpy.data.scenes if s.name.startswith('SMALL TOWN /'))
groups={}
for entry in manifest['assets']:groups.setdefault(entry['category'],[]).append(entry)

for category,entries in groups.items():
    scene=bpy.data.scenes.new('PREVIEW / '+category)
    bpy.context.window.scene=scene
    scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type='OPTIX';prefs.get_devices()
        for d in prefs.devices:d.use=d.type!='CPU'
        scene.cycles.device='GPU'
    except Exception:pass
    scene.world=template.world
    scene.view_settings.view_transform='Standard';scene.view_settings.look='None'
    scene.render.resolution_x=1600;scene.render.resolution_y=1200
    scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
    scene.render.image_settings.color_mode='RGB'
    light=bpy.data.lights.new('Sheet light','SUN');light.energy=1.9;light.angle=.20
    sun=bpy.data.objects.new('Sheet light',light);scene.collection.objects.link(sun);sun.rotation_euler=(.35,-.45,-.35)
    pts=[]
    columns=min(4,len(entries))
    for i,entry in enumerate(entries):
        ob=bpy.data.objects.new(entry['id'],None);scene.collection.objects.link(ob)
        ob.instance_type='COLLECTION';ob.instance_collection=bpy.data.collections[entry['collection']]
        scale=4.6/max(entry['dimensions'])
        center=[(a+b)/2 for a,b in zip(entry['bounds']['min'],entry['bounds']['max'])]
        ob.location=((i%columns)*7-center[0]*scale,-(i//columns)*7-center[1]*scale,-entry['bounds']['min'][2]*scale+.04)
        ob.scale=(scale,)*3
        for x in (entry['bounds']['min'][0],entry['bounds']['max'][0]):
            for y in (entry['bounds']['min'][1],entry['bounds']['max'][1]):
                for z in (entry['bounds']['min'][2],entry['bounds']['max'][2]):pts.append(Vector((x,y,z))*scale+ob.location)
        data=bpy.data.curves.new('Name','FONT');data.body=entry['id'].replace('_01','').replace('_',' ')
        data.size=.24;data.align_x='CENTER';data.materials.append(bpy.data.materials['ST / ink'])
        label=bpy.data.objects.new('Name',data);scene.collection.objects.link(label)
        label.location=((i%columns)*7,-(i//columns)*7-2.75,.025)
        pts.extend([Vector(label.location)+Vector((dx,0,0)) for dx in (-2.6,2.6)])
    mesh=bpy.data.meshes.new('Paper')
    mesh.from_pydata([(-100,-100,-.03),(100,-100,-.03),(100,100,-.03),(-100,100,-.03)],[],[(0,1,2,3)])
    mesh.materials.append(bpy.data.materials['ST / paper'])
    floor=bpy.data.objects.new('Paper',mesh);scene.collection.objects.link(floor)
    camera=bpy.data.objects.new('Camera',bpy.data.cameras.new('Camera'));scene.collection.objects.link(camera)
    scene.camera=camera;camera.data.type='ORTHO';camera.data.clip_end=500
    focus=sum(pts,Vector())/len(pts)
    camera.location=focus+Vector((3,-12,16))*5
    camera.rotation_euler=(focus-camera.location).to_track_quat('-Z','Y').to_euler()
    bpy.context.view_layer.update()
    inv=camera.matrix_world.inverted();projected=[inv@p for p in pts]
    lo=[min(p[i] for p in projected) for i in (0,1)];hi=[max(p[i] for p in projected) for i in (0,1)]
    camera.location+=camera.matrix_world.to_3x3()@Vector(((lo[0]+hi[0])/2,(lo[1]+hi[1])/2,0))
    camera.data.ortho_scale=max(hi[0]-lo[0],(hi[1]-lo[1])*4/3)*1.12
    scene.render.use_freestyle=True
    fs=scene.view_layers[0].freestyle_settings
    ls=fs.linesets[0] if fs.linesets else fs.linesets.new('Fine contours')
    ls.select_crease=False;ls.select_silhouette=True;ls.select_border=True
    ls.linestyle.color=(.13,.11,.08);ls.linestyle.thickness=.75;ls.linestyle.alpha=.65
    scene.render.filepath=str(OUT/'previews'/(category.lower()+'.png'))
    bpy.ops.render.render(write_still=True)
    print('PREVIEW_READY '+category,flush=True)
    for ob in list(scene.objects):bpy.data.objects.remove(ob,do_unlink=True)
    bpy.context.window.scene=template;bpy.data.scenes.remove(scene)
print('ALL_PREVIEWS_READY',flush=True)
