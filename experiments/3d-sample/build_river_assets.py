"""Build seven editable river-bank / timber-flat-bridge modules and GLBs.

Run in a fresh background Blender file. Source collections use metres, +Z up,
+X along the crossing, +Y across it, with the bridge walking datum at Z=0.
"""
import bpy
import sys
import math
import json
import zipfile
from pathlib import Path
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build_asset_library as kit

OUT = HERE.parents[1] / 'artifacts' / 'river-assets'
kit.OUT = OUT
Shape = kit.Shape


def add(aid, group, title, shapes, mount, stretch, sockets, notes):
    coll = kit.asset(aid, '14_RIVER', group, title, shapes, mount, stretch, sockets, notes)
    entry = kit.ASSETS[-1]
    entry['origin'] = 'Local bridge datum Z=0; +X follows the bridge, +Y crosses it; use named sockets.'
    entry['alongAxis'] = '+X'
    entry['crossAxis'] = '+Y'
    entry['coordinateContract'] = 'metric-local-v1'
    root = next(o for o in coll.objects if o.name.endswith('__ROOT'))
    root['along_axis'] = '+X'
    root['cross_axis'] = '+Y'
    return entry


def bank_profile():
    # A watertight sample section. The city adapter constructs the same profile
    # on exact source shore edges; it must not tile this block over the river.
    s = Shape()
    profile = [(0, -2), (1.5, -2), (1.5, 0), (.25, -1.15), (0, -1.45)]
    n = len(profile)
    verts = [(x, y, z) for x in (-2, 2) for y, z in profile]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]
    faces += [(i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)]
    s.poly(verts, faces, 'earth')
    # Sparse stones remain in the land-side profile, below the dry datum.
    for x, y, z in ((-1.2, .50, -.87), (.25, .68, -.71), (1.3, .92, -.48)):
        s.ellipsoid((x, y, z), (.15, .11, .07), 'cobble', seed=round((x+3)*10), sides=7, rows=4)
    e = add('river_bank_profile_01', 'river_bank', '自然河岸与河床剖面参考', {'bank': s},
            'SHORE_XZ', ('X', 'Y'),
            {'START': (-2, 0, 0), 'END': (2, 0, 0), 'WATER_EDGE': (0, .25, -1.15),
             'DRY_EDGE': (0, 1.5, 0), 'BED': (0, 0, -2)},
            '4m section; +Y is landward. City banks are generated from source-water boundaries and available dry land; this mesh is the editable profile reference.')
    e['representationPolicy'] = 'parametric-profile-reference'
    e['profileYZ'] = profile
    e['waterLevelLocal'] = -1.15
    e['stretchRange'] = {'X': [.1, 3], 'Y': [.1, 1]}


def quay_transition():
    s = Shape()
    s.box((0, 0, -1.04), (.60, .50, 1.92), 'stone')
    s.box((0, 0, -.06), (.60, .54, .12), 'limestone')
    for j in range(4):
        z = -1.78+j*.43
        s.path([(-.30, -.255, z), (.30, -.255, z)], .009, 'ink', 4)
    # Coping never rises above the bridge walking datum.
    e = add('river_quay_transition_01', 'river_bank', '护岸与桥台短收口', {'transition': s},
            'SHORE_XZ', ('X', 'Z'),
            {'START': (-.30, 0, 0), 'END': (.30, 0, 0), 'BASE': (0, 0, -2)},
            '0.6m long, 0.54m thick, from Z=-2 to 0; -Y faces water. Shorten to the exact remaining shore interval; do not cross bridge approaches.')
    e['stretchRange'] = {'X': [.05, 1], 'Z': [.5, 1.5]}


def deck():
    boards = Shape()
    # A continuous lower skin and separately ruled upper planks. The thin skin
    # prevents an empty bridge deck through the decorative plank seams.
    boards.box((0, 0, -.105), (4, 2, .11), 'oak')
    for i in range(16):
        x = -2+(i+.5)*.25
        boards.box((x, 0, -.04), (.242, 2, .08), 'oak_light' if i % 4 else 'oak')
        for y in (-.80, .80):
            boards.box((x, y, -.002), (.025, .025, .004), 'iron')
    beams = Shape()
    for y in (-.67, .67):
        beams.box((0, y, -.30), (4, .18, .24), 'oak')
    for x in (-1.5, -.5, .5, 1.5):
        beams.box((x, 0, -.26), (.16, 2, .20), 'oak')
    e = add('bridge_timber_deck_01', 'river_bridge', '木平桥板面与纵横梁',
            {'deck': boards, 'beams': beams}, 'DECK_XY', ('X', 'Y'),
            {'START': (-2, 0, 0), 'END': (2, 0, 0), 'LEFT_EDGE': (0, 1, 0),
             'RIGHT_EDGE': (0, -1, 0), 'BEAM_BOTTOM': (0, 0, -.42)},
            '4m along X by 2m across Y. Part deck top Z=0, bottom -0.16; beams Z=-0.42..-0.16. Split long bridges into modules; Y follows source bridge width.')
    e['partDimensions'] = {'deck': [4, 2, .16], 'beams': [4, 2, .26]}
    e['partBoundsZ'] = {'deck': [-.16, 0], 'beams': [-.42, -.16]}
    e['stretchRange'] = {'X': [.25, 1], 'Y': [.5, 8]}


def supports():
    s = Shape()
    for y in (-.72, .72):
        s.cylinder((0, y, -2), .12, 1.52, 'oak', 10)
        # Darker water-mark rings below the level, not floating on the surface.
        s.cylinder((0, y, -1.25), .122, .18, 'oak', 10)
    s.box((0, 0, -.48), (.22, 2, .20), 'oak')
    for sign in (-1, 1):
        s.beam((0, sign*.72, -.61), (0, -sign*.72, -1.70), .065, 'oak_light', 6)
    e = add('bridge_timber_support_01', 'river_bridge', '木桥双桩与交叉斜撑', {'support': s},
            'DECK_XY', ('Y', 'Z'),
            {'TOP': (0, 0, -.38), 'BASE': (0, 0, -2),
             'LEFT_PILE': (0, .72, -2), 'RIGHT_PILE': (0, -.72, -2)},
            'Cross beam 2m across Y; top Z=-0.38, pile feet Z=-2. Scale about explicit TOP or BASE socket to reach the generated bed; keep feet below water.')
    e['stretchRange'] = {'Y': [.5, 8], 'Z': [.65, 2.5]}


def abutment():
    s = Shape()
    s.box((0, 0, -1.08), (.80, 2, 1.84), 'stone')
    s.box((0, 0, -.25), (.80, 2, .18), 'limestone')
    for j in range(4):
        z = -1.80+j*.42
        for side in (-1, 1):
            s.path([(-.405, side, z), (.405, side, z)], .008, 'ink', 4)
    e = add('bridge_abutment_01', 'river_bridge', '两岸石桥台', {'abutment': s},
            'DECK_XY', ('Y', 'Z'),
            {'ROAD_DATUM': (0, 0, 0), 'DECK_BEARING': (0, 0, -.16),
             'BASE': (0, 0, -2), 'BANK_FACE': (.40, 0, -.16)},
            '0.8m along X by 2m across Y. Top Z=-0.16; base -2. Install on dry shore under the deck, with no raised face across the road approach.')
    e['stretchRange'] = {'Y': [.5, 8], 'Z': [.65, 2.5]}


def rail():
    s = Shape()
    for x in (-.80, .80):
        s.box((x, 0, .53), (.12, .12, .94), 'oak')
    for z in (.45, .91):
        s.box((0, 0, z), (2, .12, .12), 'oak_light')
    s.beam((-.78, 0, .30), (.78, 0, .82), .035, 'oak', 6)
    e = add('bridge_rail_01', 'river_bridge', '木桥栏杆直段', {'rail': s},
            'EDGE_XZ', ('X',),
            {'START': (-1, 0, 0), 'END': (1, 0, 0), 'MOUNT': (0, 0, 0)},
            '2m along X; all parts within Y=-0.06..0.06, Z=0.06..1.0. Mount outside the source Road.width clear lane, and stop before shared bridgehead junctions.')
    e['clearanceEnvelope'] = {'yHalfThickness': .06, 'z': [.06, 1]}
    e['stretchRange'] = {'X': [.15, 1]}


def rail_end():
    s = Shape()
    s.box((0, 0, .49), (.18, .18, .98), 'oak')
    s.box((0, 0, 1.02), (.22, .22, .08), 'oak_light')
    s.box((0, 0, .24), (.185, .185, .045), 'iron')
    e = add('bridge_rail_end_01', 'river_bridge', '桥栏端柱与端头', {'end': s},
            'EDGE_XZ', (), {'BASE': (0, 0, 0), 'TOP': (0, 0, 1.06)},
            '0.22m maximum width; base Z=0 and top 1.06. Place outside the full clear approach width; no nonuniform scaling.')
    e['clearanceEnvelope'] = {'xyHalfWidth': .11, 'z': [0, 1.06]}


def gallery(render):
    scene = bpy.data.scenes.new('RIVER / SEVEN MODULE GALLERY')
    bpy.context.window.scene = scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    # Canonical collection dimensions stay unchanged; instances are display only.
    for i, entry in enumerate(kit.ASSETS):
        ob = bpy.data.objects.new('DISPLAY / '+entry['id'], None)
        ob.instance_type = 'COLLECTION'
        ob.instance_collection = bpy.data.collections[entry['collection']]
        scene.collection.objects.link(ob)
        x, y = (i % 3)*6-6, -(i//3)*5+4
        ob.location = (x, y, .02-entry['bounds']['min'][2])
        ob['display_only'] = True
        kit.text_object(scene, entry['id'].replace('_01', '').replace('_', ' '), (x, y-1.85, .05), .16)
    # An assembled representative bridge provides an immediately useful preview.
    deck_coll = bpy.data.collections['bridge_timber_deck_01']
    for x in (-4, 0, 4):
        ob = bpy.data.objects.new('PREVIEW / deck', None)
        ob.instance_type = 'COLLECTION'; ob.instance_collection = deck_coll
        scene.collection.objects.link(ob); ob.location = (x, -13, 2)
    for y in (-14.0, -12.0):
        for x in (-5, -3, -1, 1, 3, 5):
            ob = bpy.data.objects.new('PREVIEW / rail', None)
            ob.instance_type = 'COLLECTION'; ob.instance_collection = bpy.data.collections['bridge_rail_01']
            scene.collection.objects.link(ob); ob.location = (x, y, 2)
    for x in (-4, 0, 4):
        ob = bpy.data.objects.new('PREVIEW / support', None)
        ob.instance_type = 'COLLECTION'; ob.instance_collection = bpy.data.collections['bridge_timber_support_01']
        scene.collection.objects.link(ob); ob.location = (x, -13, 2)
    kit.text_object(scene, 'assembled timber flat bridge', (0, -15.3, .05), .25)
    floor = Shape(); floor.box((0, -5, -.10), (22, 29, .20), 'paper')
    ground = bpy.data.objects.new('Gallery paper', floor.create_mesh('River gallery paper'))
    scene.collection.objects.link(ground)
    scene.render.engine = 'CYCLES'; scene.cycles.samples = 24; scene.cycles.use_denoising = True
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
        if any(d.type != 'CPU' for d in prefs.devices):
            for device in prefs.devices: device.use = device.type != 'CPU'
            scene.cycles.device = 'GPU'
    except Exception:
        pass
    scene.world = bpy.data.worlds.new('River paper daylight'); scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.91, .90, .86, 1)
    sun = bpy.data.objects.new('River gallery sun', bpy.data.lights.new('River gallery sun', 'SUN'))
    scene.collection.objects.link(sun); sun.data.energy = 1.6; sun.data.angle = .2
    sun.rotation_euler = (.4, -.5, -.35)
    camera = bpy.data.objects.new('River gallery camera', bpy.data.cameras.new('River gallery camera'))
    scene.collection.objects.link(camera); scene.camera = camera
    focus = Vector((0, -5, 1)); camera.location = (15, -29, 36)
    camera.rotation_euler = (focus-camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'; camera.data.ortho_scale = 32; camera.data.clip_end = 300
    scene.render.resolution_x = 1700; scene.render.resolution_y = 1800; scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'; scene.render.filepath = str(OUT/'previews'/'all-assets.png')
    scene.view_settings.view_transform = 'Standard'; scene.view_settings.look = 'None'
    scene.render.use_freestyle = True
    linesets = scene.view_layers[0].freestyle_settings.linesets
    line = linesets[0] if linesets else linesets.new('River ink contours')
    line.select_crease = False; line.linestyle.thickness = .65; line.linestyle.color = (.13, .12, .10)
    from illustration_v2 import apply_illustration
    apply_illustration(scene)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'river-asset-library.blend'))
    if render: bpy.ops.render.render(write_still=True)


def build(render=False):
    for folder in ('glb', 'textures', 'previews'):
        (OUT/folder).mkdir(parents=True, exist_ok=True)
    if bpy.data.collections.get('bridge_timber_deck_01'):
        raise RuntimeError('Use a fresh background file to rebuild the river library.')
    kit.make_materials()
    bank_profile(); quay_transition(); deck(); supports(); abutment(); rail(); rail_end()
    assert len(kit.ASSETS) == 7
    kit.export_models()
    groups = sorted({a['gapId'] for a in kit.ASSETS})
    manifest = {'schemaVersion': 1, 'title': 'River banks and timber flat bridge modular kit',
                'units': 'meters', 'assetCount': len(kit.ASSETS), 'kitId': 'river_kit', 'version': 1,
                'materialSlots': list(kit.PALETTE), 'assets': kit.ASSETS,
                'blendFile': 'river-asset-library.blend',
                'blenderAxes': {'up': '+Z', 'along': '+X', 'cross': '+Y', 'bridgeDatumZ': 0},
                'glTFConvention': 'glTF +Y up; reimport with the standard Blender importer.',
                'textures': 'textures/*.png, packed in Blender and embedded in every GLB',
                'requirements': [{'gapId': group, 'requiredVariants': sum(a['gapId'] == group for a in kit.ASSETS),
                                  'deliveredVariants': sum(a['gapId'] == group for a in kit.ASSETS)} for group in groups],
                'notes': 'Editable original static geometry. Bank profile is a reference recipe; city water and banks follow source polygons. No boat-clearance or structural-engineering claim.'}
    (OUT/'asset-library.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    gallery(render)
    with zipfile.ZipFile(OUT/'river-assets.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in OUT.rglob('*'):
            if file.is_file() and file.suffix not in ('.zip', '.blend1'):
                archive.write(file, file.relative_to(OUT))
    print('RIVER_LIBRARY_READY 7', flush=True)


if __name__ == '__main__':
    build(render='--render' in sys.argv)
