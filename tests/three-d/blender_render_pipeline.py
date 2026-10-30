"""Check native pixels, source state, mask indices and exception cleanup."""
import bpy,sys,importlib.util,json
from pathlib import Path
import numpy as np
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'experiments'/'3d-sample'))
from render_pipeline import render_with_ink
spec=importlib.util.spec_from_file_location('reference_ink',Path(__file__).with_name('reference_render_pipeline.py'))
reference=importlib.util.module_from_spec(spec);spec.loader.exec_module(reference)
for obj in list(bpy.data.objects):bpy.data.objects.remove(obj,do_unlink=True)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=2;scene.cycles.use_denoising=False
scene.render.resolution_x=scene.render.resolution_y=128;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
scene.view_settings.view_transform='Standard';scene.render.film_transparent=False
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.8,.8,.8,1)
ink=bpy.data.collections.new('07_INK_OUTLINES');scene.collection.children.link(ink)
for i in range(4):
    bpy.ops.mesh.primitive_cube_add(size=1,location=(i*.7,0,i*.15))
    obj=bpy.context.object;obj.name='test-'+str(i)
    if i in (0,2):ink.objects.link(obj)
    if i in (1,3):obj['authored_asset_id']='test-asset';obj['asset_mount_role']='decoration'
    if i==3:obj.hide_render=True
    mat=bpy.data.materials.new('test-material-'+str(i));mat.diffuse_color=(.4,.6,.7,1);obj.data.materials.append(mat)
camera=bpy.data.objects.new('test-camera',bpy.data.cameras.new('test-camera'));scene.collection.objects.link(camera);scene.camera=camera
camera.location=(6,-8,6);camera.rotation_euler=(Vector((1,0,0))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=4
scene.render.use_freestyle=False;scene['authored_ink_overlay']=True
line=scene.view_layers[0].freestyle_settings.linesets[0];line.select_by_collection=True;line.collection=ink
line.select_silhouette=True;line.select_border=True;line.select_crease=False
out=ROOT/'artifacts'/'3d-performance';bpy.context.view_layer.update()
def snapshot():return {'objects':[(o.name,o.hide_render,o.pass_index,tuple(o.matrix_world[:][0])) for o in scene.objects],
 'collections':[(c.name,c.users) for c in bpy.data.collections],
 'dataCounts':[len(bpy.data.objects),len(bpy.data.scenes),len(bpy.data.materials),len(bpy.data.worlds),len(bpy.data.images)],
 'render':(scene.render.use_freestyle,scene.render.filepath,scene.cycles.samples,scene.world.name,scene.cycles.use_denoising,scene.render.film_transparent,scene.render.use_persistent_data,scene.view_layers[0].material_override),
 'line':(line.collection.name,line.select_by_collection)}
def pixels(path):
    image=bpy.data.images.load(str(path),check_existing=False);values=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(values);bpy.data.images.remove(image);return values
scene.render.filepath=str(out/'render-reference.png');reference.render_with_ink(scene);baseline=pixels(out/'render-reference.png')
results=[]
for indexed,reuse in ((False,False),(True,False),(False,True),(True,True)):
    scene['authored_visibility_indices']=int(indexed)
    if indexed:
        for o in scene.objects:o.pass_index=int(bool(o.get('authored_asset_id')))
    scene.render.filepath=str(out/f'render-indexed-{indexed}-reuse-{reuse}.png');before=snapshot()
    report=render_with_ink(scene,reuse_source=reuse);assert before==snapshot()
    current=pixels(Path(scene.render.filepath));difference=np.abs(current-baseline)
    assert difference.max()<.005,(indexed,difference.max())
    assert report['maskObjectCopies']==(0 if indexed or reuse else 3)
    assert report['sceneReuse']==reuse
    results.append({'indexed':indexed,'sceneReuse':reuse,'maximumPixelChannelError':float(difference.max()),'meanPixelChannelError':float(difference.mean()),'sourceUnchanged':True})
ink.name='Temporarily absent ink collection';scene.render.filepath=str(out/'failed-render.png');before=snapshot()
for reuse in (False,True):
    try:render_with_ink(scene,reuse_source=reuse)
    except KeyError:pass
    else:raise AssertionError('Expected a missing structural collection error')
    assert before==snapshot();assert not list(out.glob('.*-beauty.png'))
result={'passed':True,'renders':results,'exceptionCleanupPassed':True}
(out/'render-regression.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result),flush=True)
