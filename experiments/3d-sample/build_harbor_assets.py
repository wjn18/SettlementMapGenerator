"""Author the shared harbor kit, editable Blender library and portable GLBs."""
import sys, math, json, hashlib, zipfile
from pathlib import Path
import bpy
from mathutils import Vector
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import build_asset_library as kit
OUT=HERE.parents[1]/'artifacts'/'harbor-assets'
kit.OUT=OUT
Shape=kit.Shape


def hull(length,width,height):
    s=Shape();stations=[(-.50,.015),(-.40,.66),(-.22,.96),(0,1),(.25,.88),(.43,.44),(.50,.012)]
    sections=[(-height*.48,.26),(-height*.18,.70),(height*.22,1.0),(height*.46,1.04)]
    s.hull_profile={'length':length,'width':width,'stations':stations,'sections':sections}
    # A closed hull shell with inner lining and a continuous dry floor.
    # The separate water mesh is cut at its true exterior waterline in assembly.
    for sign in (-1,1):
        for level,(z,f) in enumerate(sections):
            if not level:continue
            pz,pf=sections[level-1]
            for (x,a),(xx,b) in zip(stations,stations[1:]):
                s.poly([(x*length,sign*a*width/2*pf,pz),(xx*length,sign*b*width/2*pf,pz),
                        (xx*length,sign*b*width/2*f,z),(x*length,sign*a*width/2*f,z)],[(0,1,2,3)],'oak' if level%2 else 'oak_light')
            s.path([(x*length,sign*w*width/2*f,z) for x,w in stations],.025,'ink',5)
        s.path([(x*length,sign*w*width/2*1.04,height*.46) for x,w in stations],.065,'oak_light',6)
        for (x,a),(xx,b) in zip(stations,stations[1:]):
            # Interior lining, plus the thickness across the top gunwale.
            s.poly([(x*length,sign*a*width*.5*.75,-height*.06),(xx*length,sign*b*width*.5*.75,-height*.06),
                    (xx*length,sign*b*width*.5*.99,height*.46),(x*length,sign*a*width*.5*.99,height*.46)],[(0,3,2,1)],'oak_light')
            s.poly([(x*length,sign*a*width*.5*1.04,height*.46),(xx*length,sign*b*width*.5*1.04,height*.46),
                    (xx*length,sign*b*width*.5*.99,height*.46),(x*length,sign*a*width*.5*.99,height*.46)],[(0,1,2,3)],'oak_light')
    def side_ring(f):
        return [(x*length,w*width*.5*f) for x,w in stations]+[(x*length,-w*width*.5*f) for x,w in reversed(stations)]
    floor=side_ring(.75)
    s.poly([(x,y,-height*.06) for x,y in floor],[tuple(range(len(floor)))],'oak_light')
    bottom=side_ring(.26)
    s.poly([(x,y,-height*.48) for x,y in bottom],[tuple(reversed(range(len(bottom))))],'oak')
    # Close both ends between exterior bottom, rail and interior floor.
    for x,w in (stations[0],stations[-1]):
        profile=[(-w*width*.5*f,z) for z,f in sections]+[(w*width*.5*f,z) for z,f in reversed(sections)]
        s.poly([(x*length,y,z) for y,z in profile],[tuple(range(len(profile)))],'oak')
        s.poly([(x*length,-w*width*.5*.99,height*.46),(x*length,w*width*.5*.99,height*.46),
                (x*length,w*width*.5*.75,-height*.06),(x*length,-w*width*.5*.75,-height*.06)],[(0,1,2,3)],'oak_light')
    for j in range(max(5,round(length/.45))):
        x=-length*.37+(j+.5)*length*.74/max(5,round(length/.45))
        w=width*.36*(1-(abs(x)/(length*.53))**3)
        s.box((x,0,-height*.05),(.40,w*2,.025),'oak_light')
    for x in (-length*.26,0,length*.24):s.box((x,0,height*.25),(.27,width*.82,.12),'oak_light')
    s.path([(-length*.5,0,-height*.45),(length*.5,0,-height*.45)],.085,'oak')
    for x in (-.5,.5):s.beam((length*x,0,-height*.48),(length*x,0,height*.55),.10,'oak')
    return s


def sail(shape,x,z,height,width,color='linen'):
    # Slightly billowing cloth with visible seams, rigging and a reefed corner.
    verts=[];cols=6;rows=8
    for j in range(rows+1):
        t=j/rows
        for i in range(cols+1):
            u=i/cols
            verts.append((x+(u-.5)*width*(1-.36*t),-.30-math.sin(math.pi*u)*math.sin(math.pi*t)*.55,z+t*height))
    shape.poly(verts,[(j*(cols+1)+i,j*(cols+1)+i+1,(j+1)*(cols+1)+i+1,(j+1)*(cols+1)+i) for j in range(rows) for i in range(cols)],color)
    for i in (0,2,4,6):shape.path([verts[j*(cols+1)+i] for j in range(rows+1)],.015,'oak_light',4)
    for j in (0,rows):shape.path([verts[j*(cols+1)+i] for i in range(cols+1)],.025,'oak',4)


def build():
    for folder in ('glb','textures','previews'):(OUT/folder).mkdir(parents=True,exist_ok=True)
    kit.make_materials()
    sea=kit.MATS['water'];sea.name='Harbor sea / blue green pigment'
    bs=sea.node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.72;bs.inputs['Coat Weight'].default_value=.06
    s=Shape();s.box((0,0,-.04),(8,8,.08),'water')
    for y in (-2,-.7,1.4):s.path([(-2.4,y,0.015),(-1,y+.10,.015),(.9,y-.04,.015),(2.2,y+.02,.015)],.018,'water_light',4)
    kit.asset('harbor_sea_01','13_HARBOR','harbor_water','淡青海面与断续涟漪',{'water_sample':s},'WATER_XY',('X','Y'),notes='水面样片；整城按源海面多边形生成，不使用方片替代岸线。')
    s=Shape();s.box((0,0,-.85),(4,.80,1.8),'stone');s.box((0,0,.02),(4,.96,.18),'limestone')
    for j in range(4):
        z=-1.55+j*.42
        s.path([(-2,-.408,z),(2,-.408,z)],.012,'ink',4)
        for x in (-1.6,-.6,.4,1.4):s.beam((x+(j%2)*.35,-.414,z),(x+(j%2)*.35,-.414,z+.40),.011,'ink',4)
    s.box((0,-.416,-1.35),(4,.018,.30),'water')
    kit.asset('harbor_quay_01','13_HARBOR','harbor_quay','石砌护岸直段与压顶',{'quay':s},'SHORE_XZ',('X',),{'START':(-2,0,0),'END':(2,0,0)},'长4m，顶面Z=.11；局部-Y朝水，底部Z=-1.75。')
    s=Shape();s.cylinder((0,0,-1.75),.57,1.84,'stone',8);s.cylinder((0,0,.09),.64,.13,'limestone',8)
    kit.asset('harbor_quay_corner_01','13_HARBOR','harbor_quay','护岸转角压顶',{'corner':s},'SHORE_XZ')
    s=Shape()
    for j in range(6):s.box((0,-j*.35,-.12-j*.20),(1.7,.40,.22),'stone')
    kit.asset('harbor_quay_steps_01','13_HARBOR','harbor_quay','下水石阶',{'steps':s},'SHORE_XZ',notes='顶端Z=0，局部-Y下到水面；仅在安全岸段安装。')
    s=Shape()
    for j in range(10):s.box((0,-1+(j+.5)*.2,-.08),(3,.187,.16),'oak_light' if j%3 else 'oak')
    for x in (-1.14,1.14):s.box((x,0,-.26),(.18,2,.23),'oak')
    kit.asset('harbor_dock_deck_01','13_HARBOR','harbor_dock','木码头桥面',{'deck':s},'DECK_XY',('X','Y'),{'SHORE':(0,-1,0),'SEA':(0,1,0)},'3m宽、2m长；顶面Z=0，沿局部+Y延伸。')
    s=Shape()
    for x in (-1.34,1.34):s.cylinder((x,0,-2),.13,2.15,'oak',10)
    s.beam((-1.34,0,-.28),(1.34,0,-1.6),.085,'oak');s.beam((1.34,0,-.28),(-1.34,0,-1.6),.085,'oak')
    kit.asset('harbor_dock_piles_01','13_HARBOR','harbor_dock','双桩与斜撑',{'piles':s},'DECK_XY',('X',))
    s=Shape();s.cylinder((0,0,0),.14,.48,'oak',10);s.beam((-.28,0,.36),(.28,0,.36),.075,'iron');s.torus((0,0,.10),.20,.035,'oak_light',20)
    kit.asset('harbor_bollard_01','13_HARBOR','harbor_dock','系船桩与绳圈',{'bollard':s},'GROUND_XY')
    s=Shape()
    for i in range(12):s.box((-1.5+(i+.5)*.25,-.055,1.55),(.235,.10,3.1),'oak' if i%3 else 'oak_light')
    for x in (-1.57,0,1.57):s.box((x,-.12,1.6),(.11,.14,3.3),'oak_light')
    for z in (.45,2.55):s.box((0,-.135,z),(3.15,.10,.12),'iron')
    for sign in (-1,1):s.beam((sign*.10,-.17,.6),(sign*1.43,-.17,2.42),.045,'oak_light')
    s.box((0,-.12,3.28),(3.65,.35,.20),'stone')
    kit.asset('harbor_warehouse_door_01','13_HARBOR','harbor_warehouse','仓库双扇货门与石楣',{'door':s},'WALL_XZ',notes='局部-Y朝外；贴合港区建筑的既有立面，不新增建筑占地。')
    s=Shape()
    for x in (-1.75,1.75):s.beam((x,0,2.9),(x,-1.05,3.65),.08,'oak')
    s.box((0,-.5,3.65),(4.0,1.15,.13),'oak_light');s.beam((0,.1,4.3),(0,-1.7,4.3),.13,'oak')
    s.cylinder((0,-1.45,3.87),.13,.18,'iron');s.path([(0,-1.45,4.2),(0,-1.45,2.75)],.025,'oak_light')
    kit.asset('harbor_warehouse_hoist_01','13_HARBOR','harbor_warehouse','装卸雨棚与吊货梁',{'hoist':s},'WALL_XZ',notes='独立饰件；安装时验证道路与邻栋净空。')
    for aid,title,length,width,height in [('harbor_rowboat_01','小划艇',5,1.65,.85),('harbor_fishing_boat_01','单桅渔船',8,2.7,1.35),('harbor_merchant_ship_01','小型商用帆船',13,4.4,2.15),('harbor_river_cargo_01','无桅内河货船',6.2,1.8,.85)]:
        s=hull(length,width,height)
        if 'rowboat' in aid:
            for sign in (-1,1):
                s.beam((-.6,sign*.55,.40),(1,sign*2.0,.2),.045,'oak_light')
                s.box((1.1,sign*2.1,.20),(.5,.26,.06),'oak_light')
        elif 'river_cargo' in aid:
            # Low cargo stays inside the hull envelope; no mast or deployed oars.
            for x in (-1.5,-.75,.75,1.5):
                s.box((x,0,.42),(.58,.85,.48),'oak_light')
                for z in (.24,.55):s.box((x,0,z),(.60,.88,.035),'iron')
            for x in (-2.3,2.3):s.torus((x,0,.29),.22,.03,'oak_light',16)
        else:
            mast=6.4 if 'fishing' in aid else 11.5
            s.beam((-.5,0,.2),(-.5,0,mast),.09 if mast<8 else .14,'oak')
            s.beam((-length*.40,0,height*.44),(-.5,0,mast-.3),.02,'oak_light',4)
            s.beam((length*.43,0,height*.44),(-.5,0,mast-.3),.02,'oak_light',4)
            sail(s,-.5,1.9 if mast<8 else 3.2,mast*.57,width*1.6)
            if mast>8:
                s.box((-length*.28,0,height*.50),(2.0,width*.70,1.35),'oak_light')
                s.box((-length*.28,0,height*.50+.72),(2.2,width*.77,.14),'slate')
                sail(s,2.7,2.1,4.2,2.3,'cloth_blue')
            else:
                for j in range(4):s.torus((2.0,0,height*.45+j*.06),.42-j*.04,.023,'oak_light',20)
                for x in (1.1,1.7):s.box((x,-.6,height*.30),(.45,.42,.32),'oak')
        kit.asset(aid,'13_HARBOR','harbor_boats',title,{'boat':s},'WATER_XY',snaps={'WATERLINE':(0,0,0),'BOW':(length/2,0,0),'STERN':(-length/2,0,0)},notes='船首+X，Z=0为水线；整船等比缩放，停泊位置为三维装饰规则。')
        kit.ASSETS[-1]['hullProfile']=s.hull_profile
        next(o for o in bpy.data.collections[aid].objects if o.type=='MESH')['hull_profile']=json.dumps(s.hull_profile)
    from cargo_sail_assets import build_cargo_sailboats
    build_cargo_sailboats(kit,hull)
    for entry in kit.ASSETS:
        if 'hullProfile' in entry:
            next(o for o in bpy.data.collections[entry['id']].objects if o.type=='MESH')['hull_profile']=json.dumps(entry['hullProfile'])
    kit.export_models()
    manifest={'schemaVersion':1,'title':'Harbor / ink and watercolor modular kit','units':'meters','assetCount':len(kit.ASSETS),'materialSlots':list(kit.PALETTE),'assets':kit.ASSETS,'blendFile':'harbor-asset-library.blend','kitId':'harbor_kit','waterlineZ':0,'notes':'Original editable geometry; packed pigment textures and portable GLBs. No animation or water simulation.'}
    manifest['requirements']=[{'gapId':group,'requiredVariants':sum(a['gapId']==group for a in kit.ASSETS),'deliveredVariants':sum(a['gapId']==group for a in kit.ASSETS)} for group in sorted({a['gapId'] for a in kit.ASSETS})]
    (OUT/'asset-library.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    # Gallery uses actual meshes and the same illustration shader as the city.
    scene=bpy.context.scene;scene.name='HARBOR / ASSET GALLERY'
    for obj in list(scene.objects):bpy.data.objects.remove(obj,do_unlink=True)
    for i,entry in enumerate(kit.ASSETS):
        c=bpy.data.collections[entry['id']];o=bpy.data.objects.new('Gallery / '+entry['id'],None);o.instance_type='COLLECTION';o.instance_collection=c
        scene.collection.objects.link(o);o.location=((i%4)*17-25.5,(i//4)*20-20,0)
    floor=Shape();floor.box((0,0,-2.6),(88,76,.2),'paper');ob=bpy.data.objects.new('Gallery paper',floor.create_mesh('Gallery paper'));scene.collection.objects.link(ob)
    scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
        for d in prefs.devices:d.use=d.type!='CPU'
        scene.cycles.device='GPU'
    except Exception:pass
    scene.world=bpy.data.worlds.new('Harbor daylight');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.91,.90,.85,1)
    light=bpy.data.objects.new('Harbor sun',bpy.data.lights.new('Harbor sun','SUN'));scene.collection.objects.link(light);light.data.energy=1.65;light.data.angle=.2;light.rotation_euler=(.35,-.45,-.35)
    cam=bpy.data.objects.new('Gallery camera',bpy.data.cameras.new('Gallery camera'));scene.collection.objects.link(cam);scene.camera=cam
    focus=Vector((0,1,1));cam.location=(45,-73,78);cam.rotation_euler=(focus-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=83
    scene.render.resolution_x=1800;scene.render.resolution_y=1600;scene.render.resolution_percentage=100;scene.view_settings.view_transform='Standard';scene.view_settings.look='None'
    scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/'previews'/'all-assets.png')
    scene.render.use_freestyle=True;line=scene.view_layers[0].freestyle_settings.linesets[0];line.select_crease=False;line.linestyle.thickness=.65;line.linestyle.color=(.13,.12,.10)
    from illustration_v2 import apply_illustration
    apply_illustration(scene)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'harbor-asset-library.blend'))
    if '--render' in sys.argv:bpy.ops.render.render(write_still=True)
    with zipfile.ZipFile(OUT/'harbor-assets.zip','w',zipfile.ZIP_DEFLATED) as archive:
        for file in OUT.rglob('*'):
            if file.is_file() and file.suffix not in ('.zip','.blend1'):archive.write(file,file.relative_to(OUT))
    print('HARBOR_LIBRARY_READY '+str(len(kit.ASSETS)),flush=True)


if __name__=='__main__':build()
