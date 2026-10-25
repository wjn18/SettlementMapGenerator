"""Render the plaza-facing shop detail from the saved V2 scene, without resaving it."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent
OUT=HERE.parents[1]/'artifacts'/'3d-sample'/'v2'
bpy.ops.wm.open_mainfile(filepath=str(OUT/'market-quarter.blend'))
scene=bpy.context.scene
prefs=bpy.context.preferences.addons['cycles'].preferences
for backend in ('OPTIX','CUDA'):
    try:
        prefs.compute_device_type=backend;prefs.get_devices()
        if any(d.type!='CPU' for d in prefs.devices):
            for dev in prefs.devices:dev.use=dev.type!='CPU'
            scene.cycles.device='GPU';break
    except Exception:pass
target=Vector((13,-3,4.5));az=math.radians(225);el=math.radians(48)
direction=Vector((math.cos(az)*math.cos(el),math.sin(az)*math.cos(el),math.sin(el)))
cam=scene.camera;cam.location=target+direction*550
cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.ortho_scale=50
scene.render.resolution_x=2400;scene.render.resolution_y=2000;scene.render.resolution_percentage=100
scene.cycles.samples=48
scene.render.filepath=str(OUT/'market-shop-detail.png')
(OUT/'detail-camera.json').write_text(json.dumps({'target':list(target),'azimuth':225,'elevation':48,'orthoScale':50,'resolution':[2400,2000]},indent=2),encoding='utf-8')
bpy.ops.render.render(write_still=True)
print('DETAIL FINISHED',flush=True)
