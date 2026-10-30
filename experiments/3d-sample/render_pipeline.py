"""Native three-pass ink rendering with immutable source objects."""
from pathlib import Path
import json
import time
import uuid
import bpy
import numpy as np


class RenderBrightnessError(RuntimeError):
    """A daylight photograph is too dark to deliver as a successful render."""


def check_render_brightness(rgb, stage='output'):
    # Sample the whole frame, including both town and paper background. Keep
    # genuine building shadows; reject the near-black, full-frame failure.
    sample = rgb[::max(1, rgb.shape[0] // 128), ::max(1, rgb.shape[1] // 128), :3]
    luminance = sample @ np.array((.2126, .7152, .0722), dtype=np.float32)
    if not np.isfinite(luminance).all():
        raise RenderBrightnessError(stage + ': non-finite image pixels')
    median, bright = np.percentile(luminance, (50, 95))
    stats = {'median': float(median), 'percentile95': float(bright)}
    if median < .12 or bright < .45:
        raise RenderBrightnessError(stage + ': daylight image is abnormally dark ' + json.dumps(stats))
    return stats


def renderable_objects(scene):
    """Union of render-enabled collections; objects may have several owners."""
    result = set()
    def visit(layer):
        if layer.exclude or layer.collection.hide_render:
            return
        result.update(o for o in layer.collection.objects if not o.hide_render)
        for child in layer.children:
            visit(child)
    visit(scene.view_layers[0].layer_collection)
    return result


def render_with_ink(scene, visible_objects=None, reuse_source=None):
    started = time.perf_counter()
    target = Path(scene.render.filepath).resolve()
    token = uuid.uuid4().hex
    paths = [target.with_name('.' + token + '-' + name + '.png') for name in ('beauty', 'ink', 'mask')]
    source_objects = renderable_objects(scene)
    if visible_objects is not None:
        source_objects &= set(visible_objects)
    # Source order keeps shader random values and object identities stable.
    objects = [o for o in scene.objects if o in source_objects]
    # Each copied scene creates another evaluated mesh graph at render time.
    # Large cities can exhaust RAM before Cycles starts. Reuse their existing
    # graph, temporarily changing only pass settings and restoring them below.
    reuse_source = len(objects) >= 20000 if reuse_source is None else reuse_source
    source_state = None
    if reuse_source:
        print('RENDER_SCENE_REUSE ' + str(len(objects)), flush=True)
        source_state = {
            'objects': [(o, o.hide_render, o.pass_index) for o in scene.objects],
            'world': scene.world, 'override': scene.view_layers[0].material_override,
            'filepath': scene.render.filepath, 'freestyle': scene.render.use_freestyle,
            'transparent': scene.render.film_transparent,
            'persistent': scene.render.use_persistent_data,
            'samples': scene.cycles.samples, 'denoising': scene.cycles.use_denoising,
            'lines': [(line, line.select_by_collection) for line in scene.view_layers[0].freestyle_settings.linesets],
        }
        scene.render.use_persistent_data = False
    scenes, collections, copies, images, materials, worlds = [], [], [], [], [], []
    stages = {}
    brightness = {}

    def timed(name, action):
        t = time.perf_counter()
        value = action()
        stages[name] = time.perf_counter() - t
        print('RENDER_STAGE ' + name + ' ' + str(round(stages[name], 3)), flush=True)
        return value

    def pass_scene(label, members, copy_objects=False):
        if reuse_source and label != 'ink':
            included = set(members)
            for obj, hidden, index in source_state['objects']:
                hide = hidden or obj not in included
                if obj.hide_render != hide:
                    obj.hide_render = hide
                if copy_objects and obj in included and obj.type not in ('CAMERA', 'LIGHT'):
                    expected = int(bool(obj.get('authored_asset_id')) and obj.get('asset_mount_role') != 'castle_keep_shell' and not obj.get('ink_structural'))
                    if obj.pass_index != expected:
                        obj.pass_index = expected
            return scene, None
        view = scene.copy()
        scenes.append(view)
        view.name = 'Temporary ' + label + ' ' + token
        for col in list(view.collection.children):
            view.collection.children.unlink(col)
        for obj in list(view.collection.objects):
            view.collection.objects.unlink(obj)
        col = bpy.data.collections.new('Temporary ' + label + ' objects ' + token)
        collections.append(col)
        # Populate off-scene and attach once, avoiding live dependency updates.
        for obj in members:
            if copy_objects and obj.type not in ('CAMERA', 'LIGHT'):
                part = obj.copy()
                copies.append(part)
                part.pass_index = int(bool(obj.get('authored_asset_id')) and obj.get('asset_mount_role') != 'castle_keep_shell' and not obj.get('ink_structural'))
            else:
                part = obj
            col.objects.link(part)
        view.collection.children.link(col)
        return view, col

    def photograph(view, path):
        view.render.filepath = str(path)
        bpy.ops.render.render(scene=view.name, write_still=True)

    try:
        beauty, _ = timed('beauty_setup', lambda: pass_scene('beauty', objects))
        beauty.render.use_freestyle = False if scene.get('authored_ink_overlay') else scene.render.use_freestyle
        if not scene.get('authored_ink_overlay'):
            timed('beauty', lambda: photograph(beauty, target))
        else:
            timed('beauty', lambda: photograph(beauty, paths[0]))
            white_world = bpy.data.worlds.new('Temporary ink background ' + token)
            worlds.append(white_world)
            white_world.use_nodes = True
            background = white_world.node_tree.nodes['Background']
            background.inputs[0].default_value = (1, 1, 1, 1)
            background.inputs[1].default_value = 1
            white = bpy.data.materials.new('Temporary ink white ' + token)
            materials.append(white)
            white.use_nodes = True
            nodes = white.node_tree.nodes
            nodes.clear()
            emission = nodes.new('ShaderNodeEmission')
            emission.inputs['Color'].default_value = (1, 1, 1, 1)
            output = nodes.new('ShaderNodeOutputMaterial')
            white.node_tree.links.new(emission.outputs[0], output.inputs[0])
            structural = set(bpy.data.collections['07_INK_OUTLINES'].all_objects)
            ink, ink_collection = timed('ink_setup', lambda: pass_scene('ink', [o for o in objects if o in structural or o.type in ('CAMERA', 'LIGHT')]))
            ink.world = white_world
            ink.view_layers[0].material_override = white
            ink.render.film_transparent = False
            ink.cycles.samples = 1
            ink.cycles.use_denoising = False
            ink.render.use_freestyle = True
            for line in ink.view_layers[0].freestyle_settings.linesets:
                # This scene already contains only selected structural objects.
                # Avoid remapping Freestyle collection IDs on a copied scene.
                line.select_by_collection = False
            timed('structural_ink', lambda: photograph(ink, paths[1]))
            mask = white.copy()
            materials.append(mask)
            mask.name = 'Temporary authored visibility mask ' + token
            info = mask.node_tree.nodes.new('ShaderNodeObjectInfo')
            mask.node_tree.links.new(info.outputs['Object Index'], next(n for n in mask.node_tree.nodes if n.type == 'EMISSION').inputs['Color'])
            indexed = scene.get('authored_visibility_indices') == 1 and all(
                o.pass_index == int(bool(o.get('authored_asset_id')) and o.get('asset_mount_role') != 'castle_keep_shell' and not o.get('ink_structural'))
                for o in objects if o.type not in ('CAMERA','LIGHT'))
            visibility, _ = timed('mask_setup', lambda: pass_scene('visibility', objects, not indexed))
            visibility.world = white_world
            visibility.view_layers[0].material_override = mask
            visibility.render.film_transparent = False
            visibility.render.use_freestyle = False
            visibility.cycles.samples = 4
            visibility.cycles.use_denoising = False
            background.inputs[0].default_value = (0, 0, 0, 1)
            timed('authored_visibility', lambda: photograph(visibility, paths[2]))

            def compose():
                arrays = []
                for path in paths:
                    image = bpy.data.images.load(str(path), check_existing=False)
                    images.append(image)
                    array = np.empty(len(image.pixels), dtype=np.float32)
                    image.pixels.foreach_get(array)
                    array = array.reshape((image.size[1], image.size[0], 4))
                    rgb = array[:, :, :3]
                    if path == paths[0]:
                        brightness['beauty'] = check_render_brightness(rgb, 'beauty')
                    rgb[:] = np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)
                    arrays.append(array)
                beauty_pixels, ink_pixels, visibility_pixels = arrays
                visible = visibility_pixels[:, :, :1]
                beauty_pixels[:, :, :3] *= visible + (1 - visible) * ink_pixels[:, :, :3]
                np.clip(beauty_pixels, 0, 1, out=beauty_pixels)
                composed = bpy.data.images.new('Composed native ink', width=beauty_pixels.shape[1], height=beauty_pixels.shape[0], alpha=True, float_buffer=True)
                images.append(composed)
                composed.pixels.foreach_set(beauty_pixels.ravel())
                composed.save_render(str(target), scene=scene)
                # Validate the actual encoded PNG as well as the beauty pass:
                # a successful renderer exit does not prove correct brightness.
                output_image = bpy.data.images.load(str(target), check_existing=False)
                images.append(output_image)
                output_image.pixels.foreach_get(beauty_pixels.ravel())
                brightness['output'] = check_render_brightness(beauty_pixels[:, :, :3])
            timed('compose', compose)
    finally:
        def cleanup():
            if source_state:
                for obj, hidden, index in source_state['objects']:
                    if obj.hide_render != hidden:
                        obj.hide_render = hidden
                    if obj.pass_index != index:
                        obj.pass_index = index
                scene.world = source_state['world']
                scene.view_layers[0].material_override = source_state['override']
                scene.render.filepath = source_state['filepath']
                scene.render.use_freestyle = source_state['freestyle']
                scene.render.film_transparent = source_state['transparent']
                scene.render.use_persistent_data = source_state['persistent']
                scene.cycles.samples = source_state['samples']
                scene.cycles.use_denoising = source_state['denoising']
                for line, selected in source_state['lines']:
                    line.select_by_collection = selected
            # Remove new IDs in batches without touching source objects/meshes.
            for ids in (scenes, copies, collections, images, materials, worlds):
                if ids:
                    bpy.data.batch_remove(ids=ids)
            for path in paths:
                if path.exists():
                    path.unlink()
        timed('cleanup', cleanup)
    report = {'version': 3, 'seconds': time.perf_counter() - started, 'stages': stages,
              'sourceObjects': len(scene.objects), 'visibleObjects': len(objects), 'maskObjectCopies': len(copies),
              'resolution': [scene.render.resolution_x, scene.render.resolution_y],
              'samples': scene.cycles.samples, 'device': scene.cycles.device,
              'sceneReuse': bool(reuse_source),
              'brightness': brightness,
              'method': 'native beauty + structural ink + authored visibility; source state restored'}
    target.with_suffix('.render.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print('RENDER_COMPOSED ' + str(target), flush=True)
    return report
