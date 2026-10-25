"""Native beauty + small architectural ink pass, composited in linear color.

Freestyle otherwise reconstructs all dense authored meshes as occluders even
when its line set selects only the structural collection. Rendering the ink
separately bounds that cost. A native object-index mask removes lines hidden
behind the authored assets. No model pixels are repainted or generated.
"""
from pathlib import Path
import uuid
import bpy
import numpy as np


def render_with_ink(scene):
    if not scene.get('authored_ink_overlay'):
        bpy.ops.render.render(write_still=True)
        return
    target=Path(scene.render.filepath).resolve()
    token=uuid.uuid4().hex
    paths=[target.with_name('.'+token+'-'+name+'.png') for name in ('beauty','ink','mask')]
    layer=scene.view_layers[0]
    state={'filepath':scene.render.filepath,'freestyle':scene.render.use_freestyle,
           'samples':scene.cycles.samples,'denoise':scene.cycles.use_denoising,
           'world':scene.world,'override':layer.material_override,
           'transparent':scene.render.film_transparent,
           'objects':{o:(o.hide_render,o.pass_index) for o in scene.objects}}
    white_world=bpy.data.worlds.new('Temporary ink background');white_world.use_nodes=True
    background=white_world.node_tree.nodes['Background']
    background.inputs[0].default_value=(1,1,1,1);background.inputs[1].default_value=1
    white=bpy.data.materials.new('Temporary ink white');white.use_nodes=True
    nodes=white.node_tree.nodes;nodes.clear()
    emission=nodes.new('ShaderNodeEmission');emission.inputs['Color'].default_value=(1,1,1,1)
    output=nodes.new('ShaderNodeOutputMaterial');white.node_tree.links.new(emission.outputs[0],output.inputs[0])
    mask=white.copy();mask.name='Temporary authored visibility mask'
    info=mask.node_tree.nodes.new('ShaderNodeObjectInfo')
    mask.node_tree.links.new(info.outputs['Object Index'],next(n for n in mask.node_tree.nodes if n.type=='EMISSION').inputs['Color'])
    images=[]
    try:
        scene.render.use_freestyle=False;scene.render.filepath=str(paths[0])
        print('RENDER_PASS beauty',flush=True);bpy.ops.render.render(write_still=True)
        structural=set(bpy.data.collections['07_INK_OUTLINES'].all_objects)
        for obj,(hidden,index) in state['objects'].items():
            if obj.type=='MESH':obj.hide_render=hidden or obj not in structural
        scene.world=white_world;layer.material_override=white
        scene.render.film_transparent=False;scene.cycles.samples=1;scene.cycles.use_denoising=False
        scene.render.use_freestyle=True;scene.render.filepath=str(paths[1])
        print('RENDER_PASS structural ink',flush=True);bpy.ops.render.render(write_still=True)
        for obj,(hidden,index) in state['objects'].items():
            obj.hide_render=hidden;obj.pass_index=1 if obj.get('authored_asset_id') else 0
        scene.render.use_freestyle=False;scene.cycles.samples=4
        layer.material_override=mask;background.inputs[0].default_value=(0,0,0,1)
        scene.render.filepath=str(paths[2])
        print('RENDER_PASS authored visibility',flush=True);bpy.ops.render.render(write_still=True)
        arrays=[]
        for path in paths:
            image=bpy.data.images.load(str(path),check_existing=False);images.append(image)
            array=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(array)
            array=array.reshape((image.size[1],image.size[0],4))
            # Blender exposes byte-image pixels in their encoded space. Float
            # output images expect linear values; decode once before blending.
            rgb=array[:,:,:3]
            rgb[:]=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
            arrays.append(array)
        beauty,ink,visibility=arrays
        visible=visibility[:,:,:1]
        beauty[:,:,:3]*=visible+(1-visible)*ink[:,:,:3]
        np.clip(beauty,0,1,out=beauty)
        composed=bpy.data.images.new('Composed native ink',width=beauty.shape[1],height=beauty.shape[0],alpha=True,float_buffer=True)
        images.append(composed);composed.pixels.foreach_set(beauty.ravel())
        composed.save_render(str(target),scene=scene)
        print('RENDER_COMPOSED '+str(target),flush=True)
    finally:
        scene.render.filepath=state['filepath'];scene.render.use_freestyle=state['freestyle']
        scene.cycles.samples=state['samples'];scene.cycles.use_denoising=state['denoise']
        scene.world=state['world'];layer.material_override=state['override']
        scene.render.film_transparent=state['transparent']
        for obj,(hidden,index) in state['objects'].items():obj.hide_render=hidden;obj.pass_index=index
        for image in images:bpy.data.images.remove(image)
        bpy.data.materials.remove(mask);bpy.data.materials.remove(white);bpy.data.worlds.remove(white_world)
        for path in paths:
            if path.exists():path.unlink()
