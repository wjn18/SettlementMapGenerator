"""Author a stone keep kit, five modules and one assembled editable model.

blender -b --factory-startup -t 8 --python build_castle_assets.py -- --render
The existing small-town library and scenes are not overwritten.
"""
import bpy
import json
import math
import sys
from pathlib import Path
from mathutils import Matrix, Vector

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import build_asset_library as kit
OUT=HERE.parents[1]/'artifacts'/'castle-assets'
kit.OUT=OUT
for folder in ('glb','textures','previews'):(OUT/folder).mkdir(parents=True,exist_ok=True)
Shape=kit.Shape


def masonry_materials():
    kit.PALETTE['stone']=(.58,.59,.55)
    kit.PALETTE['limestone']=(.76,.76,.68)
    kit.PALETTE['slate']=(.23,.31,.35)
    kit.make_materials()
    for key,mat in kit.MATS.items():mat.name='CK / '+key
    # A portable, staggered ashlar texture. Its UV period is two metres.
    image=bpy.data.images.new('CK_ashlar',256,256,alpha=False)
    pixels=[]
    for y in range(256):
        row=y//64;yy=y%64
        for x in range(256):
            xx=(x+(row%2)*64)%128;column=(x+(row%2)*64)//128
            joint=min(xx,127-xx,yy,63-yy)<1.7
            tint=.77 if joint else .96+.045*math.sin(row*2.3+column*1.8)+.026*math.sin(x*.49+y*.43)
            color=[c*tint for c in kit.PALETTE['stone']]
            pixels.extend([1.055*c**(1/2.4)-.055 for c in color]+[1])
    image.pixels.foreach_set(pixels);image.filepath_raw=str(OUT/'textures'/'ashlar.png');image.file_format='PNG';image.save();image.pack()
    mat=kit.MATS['stone'];nodes=mat.node_tree.nodes;links=mat.node_tree.links
    texture=next(n for n in nodes if n.type=='TEX_IMAGE');texture.image=image
    uv=nodes.new('ShaderNodeTexCoord');scale=nodes.new('ShaderNodeVectorMath');scale.operation='SCALE';scale.inputs[3].default_value=.5
    links.new(uv.outputs['UV'],scale.inputs[0]);links.new(scale.outputs[0],texture.inputs['Vector'])


def hipped_roof(width=12,length=16,rise=3):
    s=Shape();w,l=width/2,length/2;run=min(width*.42,length*.25);r=l-run
    s.poly([(-w,-l,0),(w,-l,0),(w,l,0),(-w,l,0),(0,-r,rise),(0,r,rise)],
           [(0,1,4),(1,2,5,4),(2,3,5),(3,0,4,5),(3,2,1,0)],'slate')
    # Seams follow each real hip plane. Their ends stop at its intersections.
    for j in range(1,14):
        t=j/14;x=w*t;z=rise*(1-t)+.022;extent=r+run*t
        for sign in (-1,1):
            s.beam((sign*x,-extent,z),(sign*x,extent,z),.014,'ink',4)
            for k in range(math.ceil(extent*2/.58)):
                y=-extent+(k+.5+(j%2)*.5)*.58
                if y>=extent:continue
                inner=w*(j-1)/14;inner_extent=r+run*(j-1)/14
                if abs(y)<=inner_extent:s.beam((sign*x,y,z),(sign*inner,y,z+rise/14),.008,'ink',4)
    for sign in (-1,1):
        for j in range(1,8):
            t=j/8;y=sign*(r+run*t);z=rise*(1-t)+.022;extent=w*t
            s.beam((-extent,y,z),(extent,y,z),.014,'ink',4)
        for x in (-w,w):s.beam((x,sign*l,.025),(0,sign*r,rise+.025),.055,'slate',6)
    count=max(1,math.ceil(2*r/.48));pitch=2*r/count
    for j in range(count):s.box((0,-r+(j+.5)*pitch,rise+.055),(.24,pitch*.94,.11),'slate')
    return s


def parapet():
    s=Shape()
    s.box((0,.34,.43),(2.4,.68,.86),'stone')
    s.box((0,.34,.88),(2.4,.74,.13),'limestone')
    s.box((0,.34,1.37),(1.12,.68,.98),'stone')
    s.box((0,.34,1.88),(1.22,.77,.11),'limestone')
    s.box((0,-.008,1.39),(.10,.022,.48),'iron')
    return s


def turret():
    s=Shape();w=3.2;h=3.75
    s.box((0,0,.12),(w,w,.24),'limestone')
    for turn in range(4):
        f=Shape()
        # Thick walls around an actual narrow arrow aperture.
        span=3.2 if turn%2==0 else 2.4
        side_width=(span-.24)/2
        for x in (-(span+.24)/4,(span+.24)/4):f.box((x,.20,h/2),(side_width,.40,h),'stone')
        f.box((0,.20,.68),(.24,.40,1.36),'stone')
        f.box((0,.20,3.28),(.24,.40,.94),'stone')
        f.box((0,.36,2.10),(.22,.03,1.47),'iron')
        f.box((0,.22,1.32),(.40,.53,.10),'limestone')
        append(s,f,Matrix.Rotation(turn*math.pi/2,4,'Z')@Matrix.Translation((0,-w/2,0)))
    s.box((0,0,h),(w,w,.18),'limestone')
    for x in (-1.16,0,1.16):
        for y in (-1.16,1.16):
            s.box((x,y,h+.58),(.78,.78,1.0),'stone')
            s.box((x,y,h+1.10),(.86,.86,.10),'limestone')
    for y in (0,):
        for x in (-1.16,1.16):
            s.box((x,y,h+.58),(.78,.78,1.0),'stone')
            s.box((x,y,h+1.10),(.86,.86,.10),'limestone')
    return s


def openings():
    slit=Shape()
    slit.box((0,-.045,1.0),(.22,.035,1.68),'iron')
    for x in (-.23,.23):slit.box((x,-.11,1.0),(.22,.26,2.0),'limestone')
    for z in (.02,1.98):slit.box((0,-.13,z),(.68,.32,.20),'limestone')
    chamber=Shape()
    for x in (-.38,.38):kit.arch(chamber,.40,.92,x=x,y=-.10,z=.18,pointed=False,fill='glass',frame='limestone',lead=False)
    chamber.box((0,-.18,.10),(1.48,.42,.18),'limestone')
    chamber.box((0,-.05,1.57),(1.47,.28,.17),'stone')
    door=Shape();kit.arch(door,1.85,2.55,y=-.12,z=0,pointed=False,fill='oak',frame='limestone',lead=False)
    for z in (.55,1.45,2.35):door.box((0,-.25,z),(1.68,.09,.10),'iron')
    for x in (-.13,.13):door.torus((x,-.31,1.2),.075,.018,'iron',12,5)
    shield=[(-.44,4.08),(.44,4.08),(.41,3.56),(0,3.15),(-.41,3.56)]
    door.panel(shield,-.19,.12,'limestone')
    door.panel([(-.28,3.94),(.28,3.94),(.25,3.60),(0,3.34),(-.25,3.60)],-.22,.02,'slate')
    return {'arrow_loop':slit,'chamber_window':chamber,'entrance':door}


def masonry():
    body=Shape();body.box((0,0,9),(12,16,18),'stone')
    belt=Shape();belt.box((0,-.08,.12),(3,.32,.24),'limestone')
    corbel=Shape()
    corbel.box((0,-.12,.42),(.48,.38,.26),'limestone')
    corbel.poly([(-.18,0,0),(.18,0,0),(-.18,-.33,.32),(.18,-.33,.32),(-.18,0,.32),(.18,0,.32)],
                [(0,1,3,2),(0,2,4),(1,5,3),(2,3,5,4),(0,4,5,1)],'stone')
    return {'wall_core':body,'belt_course':belt,'corbel':corbel}


def append(target,source,matrix=Matrix.Identity(4)):
    offset=len(target.vertices);target.vertices.extend([tuple(matrix@Vector(v)) for v in source.vertices])
    target.faces.extend([tuple(offset+i for i in face) for face in source.faces]);target.slots.extend(source.slots)


def build():
    masonry_materials();roof=hipped_roof();rim=parapet();tower=turret();windows=openings();stone=masonry()
    specs=[('castle_keep_masonry_01','主堡石砌墙身、腰线与托石',stone,'GROUND_XY',('X','Y','Z')),
           ('castle_keep_roof_01','主堡内收四坡板岩顶',{'hipped_roof':roof},'ROOF_XY',('X','Y','Z')),
           ('castle_keep_parapet_01','主堡女墙、垛口与箭孔',{'parapet_bay':rim},'EAVE_XY',('X',)),
           ('castle_keep_turret_01','主堡方角楼与上层战斗平台',{'stone_turret':tower},'ROOF_XY',()),
           ('castle_keep_openings_01','窄箭窗、双拱小窗与石券入口',windows,'WALL_XZ',())]
    for aid,title,parts,mount,stretch in specs:
        kit.asset(aid,'12_CASTLE_KEEP','castle_keep_kit',title,parts,mount,stretch,
                  notes='石砌主堡专用；按既有建筑轮廓适配，角楼及屋顶不增加落地占地。门窗为独立部件。')
    assembled=Shape();append(assembled,stone['wall_core'])
    append(assembled,roof,Matrix.Translation((0,0,18.08))@Matrix.Diagonal((.55,.54,1,1)))
    for x in (-4.3,4.3):
        for y in (-6.3,6.3):append(assembled,tower,Matrix.Translation((x,y,18)))
    for length,origin,angle in [(12,(0,-8,18),0),(16,(6,0,18),math.pi/2),(12,(0,8,18),math.pi),(16,(-6,0,18),-math.pi/2)]:
        n=round(length/2.4)
        for i in range(n):append(assembled,rim,Matrix.Translation(origin)@Matrix.Rotation(angle,4,'Z')@Matrix.Translation((-length/2+(i+.5)*length/n,0,0))@Matrix.Diagonal((length/n/2.4,1,1,1)))
        for z in (1.2,9,17.45):append(assembled,stone['belt_course'],Matrix.Translation((origin[0],origin[1],z))@Matrix.Rotation(angle,4,'Z')@Matrix.Diagonal((length/3,1,1,1)))
        for x in (-length*.28,length*.28):
            for z in (4.0,10.2):append(assembled,windows['arrow_loop'],Matrix.Translation((origin[0],origin[1],z))@Matrix.Rotation(angle,4,'Z')@Matrix.Translation((x,0,0)))
            append(assembled,windows['chamber_window'],Matrix.Translation((origin[0],origin[1],14.1))@Matrix.Rotation(angle,4,'Z')@Matrix.Translation((x,0,0)))
    append(assembled,windows['entrance'],Matrix.Translation((0,-8,.08)))
    kit.asset('castle_keep_assembled_01','12_CASTLE_KEEP','castle_keep_kit','主堡完整装配示例',{'assembled_keep':assembled},
              notes='12×16m示例，墙身18m。整城生成使用五个独立模块适配原轮廓，本完整示例不直接包围盒拉伸。')
    kit.export_models()
    manifest={'schemaVersion':1,'title':'Castle / authored stone keep kit','units':'meters','assetCount':len(kit.ASSETS),
              'materialSlots':list(kit.PALETTE),'assets':kit.ASSETS,'kitId':'castle_keep_kit','blendFile':'castle-asset-library.blend',
              'requirements':[{'gapId':'castle_keep_kit','priority':'P0','requiredVariants':6,'deliveredVariants':6}],
              'integration':'Castle district: largest existing footprint = keep; remaining footprints = lower stone service halls. No new ground polygons.',
              'scope':'Main keep kit only. Dedicated outer gatehouses, wall-walk stairs, wall towers and courtyard props remain separate gaps.'}
    (OUT/'asset-library.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    scene=bpy.context.scene;scene.name='CASTLE KEEP / ASSEMBLED'
    for obj in list(scene.objects):bpy.data.objects.remove(obj,do_unlink=True)
    scene.collection.children.link(bpy.data.collections['castle_keep_assembled_01'])
    floor=Shape();floor.box((0,0,-.18),(70,70,.3),'paper')
    ob=bpy.data.objects.new('Gallery paper',floor.create_mesh('Gallery paper'));scene.collection.objects.link(ob)
    scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
        for device in prefs.devices:device.use=device.type!='CPU'
        scene.cycles.device='GPU'
    except Exception:pass
    scene.world=bpy.data.worlds.new('Keep daylight');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.91,.90,.85,1)
    light=bpy.data.objects.new('Keep sun',bpy.data.lights.new('Keep sun','SUN'));scene.collection.objects.link(light)
    light.data.energy=2.0;light.data.angle=.18;light.rotation_euler=(.35,-.45,-.35)
    camera=bpy.data.objects.new('Keep camera',bpy.data.cameras.new('Keep camera'));scene.collection.objects.link(camera);scene.camera=camera
    focus=Vector((0,0,10.8));camera.location=(40,-52,47);camera.rotation_euler=(focus-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO';camera.data.ortho_scale=35
    scene.render.resolution_x=1600;scene.render.resolution_y=1600;scene.render.resolution_percentage=100
    scene.view_settings.view_transform='Standard';scene.view_settings.look='None'
    scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/'previews'/'assembled-keep.png')
    scene.render.use_freestyle=True;ls=scene.view_layers[0].freestyle_settings.linesets[0]
    ls.select_crease=False;ls.select_silhouette=True;ls.select_border=True;ls.linestyle.thickness=.75;ls.linestyle.color=(.13,.12,.10)
    from illustration_v2 import apply_illustration
    apply_illustration(scene)
    scene['kit_id']='castle_keep_kit';scene['asset_count']=6
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'castle-asset-library.blend'))
    print('CASTLE_LIBRARY_READY',flush=True)
    if '--render' in sys.argv:bpy.ops.render.render(write_still=True)


if __name__=='__main__':build()
