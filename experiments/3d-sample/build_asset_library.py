"""Author the 61 P0/P1 small-town kits in Blender, with portable PBR exports.

Run inside Blender, or: blender -b -t 8 --python build_asset_library.py
No input scene is deleted. Assets are local-space collections; gallery instances
have display-only scales. The historic town scene is never overwritten.
"""
import bpy
import bmesh
import math
import json
import random
import hashlib
import sys
from pathlib import Path
from mathutils import Vector

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[1] / 'artifacts' / 'small-town-assets'
for folder in ('glb', 'textures', 'previews'):
    (OUT / folder).mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(HERE))
from props import Mesh

PALETTE = {
    'ink': (.095, .080, .060), 'oak': (.29, .20, .12),
    'oak_light': (.52, .37, .22), 'stone': (.67, .64, .54),
    'limestone': (.83, .79, .66), 'slate': (.34, .43, .46),
    'tile': (.65, .37, .23), 'plaster': (.86, .80, .65),
    'iron': (.15, .18, .17), 'brass': (.57, .41, .16),
    'glass': (.17, .31, .33), 'glass_amber': (.72, .46, .19),
    'glass_red': (.49, .19, .15), 'leaf': (.29, .40, .24),
    'leaf_light': (.46, .53, .29), 'leaf_dark': (.19, .31, .25),
    'linen': (.84, .77, .60), 'cloth_blue': (.27, .40, .46),
    'cloth_red': (.52, .26, .22), 'cloth_green': (.39, .46, .28),
    'skin': (.67, .46, .30), 'skin_light': (.82, .63, .43),
    'bread': (.67, .45, .22), 'apple': (.58, .26, .17),
    'pottery': (.65, .40, .28), 'water': (.34, .57, .56),
    'water_light': (.68, .83, .76), 'earth': (.56, .46, .32),
    'cobble': (.57, .58, .51), 'paper': (.91, .87, .77),
}
MATS = {}


def make_materials():
    """Small seamless pigment textures survive glTF without shader baking."""
    for index, (key, color) in enumerate(PALETTE.items()):
        mat = bpy.data.materials.new('ST / ' + key)
        mat.use_nodes = True
        mat.diffuse_color = (*color, 1)
        mat['semantic_slot'] = key
        image = bpy.data.images.new('ST_' + key, 128, 128, alpha=False)
        values = []
        rng = random.Random(730 + index)
        # The border wraps exactly: all coarse functions are periodic.
        for y in range(128):
            for x in range(128):
                u, v = x / 128, y / 128
                pigment = 1 + .035 * math.sin(math.tau * (u + v)) + .025 * math.cos(math.tau * (3*u-v))
                pigment += rng.uniform(-.024, .024)
                if key.startswith('oak'):
                    pigment -= .11 * max(0, math.cos(math.tau*(u*12+.17*math.sin(math.tau*v))))**18
                if key == 'cobble':
                    row = int(v*8)
                    xx = (u*8 + (row % 2)*.5) % 1
                    yy = (v*8) % 1
                    pigment *= .58 if min(xx, 1-xx, yy, 1-yy) < .055 else 1
                if key == 'earth':
                    pigment += .07 * math.cos(math.tau*(u*7+v*9)) * math.sin(math.tau*(u*13-v*5))
                # Convert linear palette colors to an sRGB image; Blender decodes it.
                rgb = [max(0, min(1, c*pigment)) for c in color]
                values.extend([12.92*c if c <= .0031308 else 1.055*c**(1/2.4)-.055 for c in rgb] + [1])
        image.pixels.foreach_set(values)
        image.filepath_raw = str(OUT / 'textures' / (key + '.png'))
        image.file_format = 'PNG'
        image.save()
        image.pack()
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = image
        tex.extension = 'REPEAT'
        bs = mat.node_tree.nodes.get('Principled BSDF')
        mat.node_tree.links.new(tex.outputs['Color'], bs.inputs['Base Color'])
        bs.inputs['Roughness'].default_value = .85 if key not in ('water', 'water_light', 'iron', 'brass', 'glass') else .29
        bs.inputs['Metallic'].default_value = .65 if key in ('iron', 'brass') else 0
        if key in ('water', 'water_light'):
            bs.inputs['Coat Weight'].default_value = .35
        MATS[key] = mat


class Shape(Mesh):
    def __init__(self):
        super().__init__(MATS)

    def ellipsoid(self, p, size, mat, seed=0, sides=12, rows=7, rough=0):
        rng = random.Random(seed)
        verts = []
        for j in range(rows+1):
            phi = math.pi*(.001 + .998*j/rows)
            for i in range(sides):
                angle = math.tau*i/sides
                f = 1 + rng.uniform(-rough, rough)
                verts.append((p[0]+math.sin(phi)*math.cos(angle)*size[0]*f,
                              p[1]+math.sin(phi)*math.sin(angle)*size[1]*f,
                              p[2]+math.cos(phi)*size[2]*f))
        faces = [(j*sides+i, j*sides+(i+1)%sides, (j+1)*sides+(i+1)%sides, (j+1)*sides+i)
                 for j in range(rows) for i in range(sides)]
        faces += [tuple(reversed(range(sides))), tuple(rows*sides+i for i in range(sides))]
        self.poly(verts, faces, mat)

    def torus(self, p, radius, tube, mat, segments=32, cross=6):
        verts = []
        for i in range(segments):
            a = i*math.tau/segments
            for j in range(cross):
                b = j*math.tau/cross
                verts.append((p[0]+(radius+tube*math.cos(b))*math.cos(a),
                              p[1]+(radius+tube*math.cos(b))*math.sin(a), p[2]+tube*math.sin(b)))
        self.poly(verts, [(i*cross+j, ((i+1)%segments)*cross+j, ((i+1)%segments)*cross+(j+1)%cross, i*cross+(j+1)%cross)
                          for i in range(segments) for j in range(cross)], mat)

    def path(self, points, r, mat, sides=8):
        for a, b in zip(points, points[1:]):
            self.beam(a, b, r, mat, sides)

    def panel(self, outline, y, thickness, mat):
        n = len(outline)
        self.poly([(x, yy, z) for yy in (y, y+thickness) for x,z in outline],
                  [tuple(reversed(range(n))), tuple(n+i for i in range(n))] +
                  [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)], mat)

    def pitched_roof(self, width=4, length=4, rise=1.8, z=0, mat='slate', tile=True):
        for sign in (-1, 1):
            self.poly([(0,-length/2,z+rise),(0,length/2,z+rise),
                       (sign*width/2,length/2,z),(sign*width/2,-length/2,z)],
                      [(0,1,2,3)], mat)
            if tile:
                rows = max(3, round(width/.46))
                for j in range(1, rows+1):
                    t = j/rows
                    x, zz = sign*width/2*t, z+rise*(1-t)+.025
                    self.beam((x,-length/2,zz),(x,length/2,zz),.018, 'ink', 4)
                    for k in range(max(1, round(length/.48))):
                        yy = -length/2 + (k+.5+(j%2)*.5)*.48
                        if yy < length/2:
                            self.beam((x,yy,zz),(x-sign*width/2/rows,yy,zz+rise/rows),.010,'ink',4)
        for y in (-length/2, length/2):
            self.path([(-width/2,y,z),(0,y,z+rise),(width/2,y,z)],.065,'limestone')
        for y in [(-length/2 + .22 + i*.44) for i in range(math.ceil(length/.44))]:
            self.rings((0,y,z+rise),[(0,.13,.21),(.12,.10,.19)],'limestone',8)


def arch_outline(width, spring, pointed=True, x=0, z=0, count=16):
    if pointed:
        left = [(width/2+width*math.cos(math.pi-i*math.pi/3/count),
                 spring+width*math.sin(math.pi-i*math.pi/3/count)) for i in range(count+1)]
        right = [(-width/2+width*math.cos(math.pi/3-i*math.pi/3/count),
                  spring+width*math.sin(math.pi/3-i*math.pi/3/count)) for i in range(1,count+1)]
        curve = left + right
    else:
        curve = [(width/2*math.cos(math.pi-i*math.pi/count), spring+width/2*math.sin(math.pi-i*math.pi/count)) for i in range(count+1)]
    return [(x-width/2,z)] + [(x+xx,z+zz) for xx,zz in curve] + [(x+width/2,z)]


def arch(s, width=1.4, spring=1.5, y=-.12, z=0, x=0, pointed=True, fill='glass', frame='limestone', lead=True):
    outline = arch_outline(width, spring, pointed, x, z)
    if fill:
        s.panel(outline,y,.09,fill)
    s.path([(xx,y-.035,zz) for xx,zz in outline],.085,frame)
    s.beam((x-width*.55,y-.04,z),(x+width*.55,y-.04,z),.10,frame)
    if lead and fill:
        top = z+spring+width*(.866 if pointed else .5)
        for offset in (-.24, .24):
            xx=x+offset*width
            s.beam((xx,y-.07,z+.08),(xx,y-.07,z+spring+.15),.018,'brass',4)
        s.beam((x-width*.48,y-.08,z+spring*.58),(x+width*.48,y-.08,z+spring*.58),.022,'brass',4)
        s.beam((x,y-.08,z+.05),(x,y-.08,top-.1),.021,'brass',4)
        for sign in (-1,1):
            s.beam((x,y-.085,z+spring*.48),(x+sign*width*.42,y-.085,z+spring*.80),.017,'brass',4)


ASSETS = []
SCENE = None


def asset(asset_id, category, group, title, shapes, mount='GROUND_XY', stretch=(), snaps=None, notes=''):
    coll = bpy.data.collections.new(asset_id)
    root = bpy.data.objects.new(asset_id+'__ROOT',None)
    coll.objects.link(root)
    root.empty_display_size=.22
    root['asset_id']=asset_id
    root['category']=category
    root['mount_plane']=mount
    root['front_axis']='-Y'
    root['up_axis']='+Z'
    root['stretch_axes']=','.join(stretch) or 'uniform_only'
    root['notes']=notes
    meshes=[]
    for part_name, shape in shapes.items():
        if not shape.vertices:
            continue
        data=shape.create_mesh(asset_id+'__'+part_name)
        bm=bmesh.new();bm.from_mesh(data)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bm.to_mesh(data);bm.free();data.update()
        ob=bpy.data.objects.new(data.name,data)
        coll.objects.link(ob)
        ob.parent=root
        ob['asset_id']=asset_id
        ob['part_role']=part_name
        uv=data.uv_layers.new(name='ST_uv_meters')
        for face in data.polygons:
            normal=face.normal
            axis=max(range(3), key=lambda i:abs(normal[i]))
            axes=[i for i in range(3) if i!=axis]
            for li in face.loop_indices:
                co=data.vertices[data.loops[li].vertex_index].co
                uv.data[li].uv=(co[axes[0]],co[axes[1]])
        meshes.append(ob)
    for name, co in (snaps or {'MOUNT':(0,0,0)}).items():
        snap=bpy.data.objects.new(asset_id+'__'+name,None)
        coll.objects.link(snap)
        snap.parent=root
        snap.location=co
        snap.empty_display_type='ARROWS'
        snap.empty_display_size=.14
        snap['socket_role']=name
    pts=[ob.matrix_local@v.co for ob in meshes for v in ob.data.vertices]
    lo=[min(p[i] for p in pts) for i in range(3)]
    hi=[max(p[i] for p in pts) for i in range(3)]
    coll.asset_mark()
    coll.asset_data.description=title+' | '+mount+' | '+notes
    coll.asset_data.author='Small Town project / original geometry'
    for tag in (category,group,'small-town','modular'):
        coll.asset_data.tags.new(tag)
    entry={'id':asset_id,'title':title,'category':category,'gapId':group,
           'collection':coll.name,'file':'glb/'+asset_id+'.glb',
           'mountPlane':mount,'frontAxis':'-Y','upAxis':'+Z','stretchAxes':list(stretch),
           'origin':'kit reference at local (0,0,0); use named sockets for separate parts; ground assets rest at Z=0',
           'bounds':{'min':lo,'max':hi},'dimensions':[hi[i]-lo[i] for i in range(3)],
           'sockets':snaps or {'MOUNT':(0,0,0)},'parts':[ob['part_role'] for ob in meshes],
           'vertices':sum(len(o.data.vertices) for o in meshes),
           'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes),
           'notes':notes,'state':'authored_3d_kit'}
    ASSETS.append(entry)
    return coll


def church():
    s=Shape();s.pitched_roof(6,8,3,0)
    for x in (-3,3):
        for z,w in ((0,.28),(-.15,.38),(-.30,.24)):
            s.box((x,0,z),(w,8.25,.14),'limestone')
    for y in (-4,4):
        for x in (-3,3):
            s.rings((x,y,-.3),[(0,.18,.18),(.55,.15,.15),(.95,.02,.02)],'limestone',8)
        s.beam((0,y,3),(0,y,3.8),.06,'limestone')
        s.beam((-.22,y,3.56),(.22,y,3.56),.06,'limestone')
    asset('cathedral_roof_01','01_CATHEDRAL','cathedral_district_kit','主堂石檐口与板岩屋顶',{'roof_and_cornice':s},'EAVE_XY',('X','Y'),notes='X=跨坡宽6m，Y=屋脊长8m；平面随现有体量裁切，石檐位于Z=0。')
    s=Shape();door=Shape();arch(s,1.55,1.8,z=.12)
    arch(door,1.85,2.05,x=2.65,fill='oak',lead=False)
    for x in (2.35,2.95):
        for z in (.65,1.35):
            door.box((x,-.20,z),(.64,.05,.055),'iron')
    # Separate pieces can be installed independently on a wall.
    asset('cathedral_openings_01','01_CATHEDRAL','cathedral_district_kit','尖拱门、柳叶窗与石框',{'lancet_window':s,'pointed_door':door},'WALL_XZ',('X','Z'),snaps={'WINDOW_MOUNT':(0,0,0),'DOOR_MOUNT':(2.65,0,0)},notes='门窗为独立对象，可分别安装。墙面Y=0，正面朝-Y。')
    s=Shape();bell=Shape()
    for x in (-1.35,1.35):
        for y in (-1.35,1.35):
            s.box((x,y,1.60),(.42,.42,3.2),'stone')
            s.box((x,y,.15),(.57,.57,.3),'limestone')
    for z in (.14,3.20,3.42):
        s.box((0,0,z),(3.1,3.1,.20),'limestone')
    for y in (-1.35,1.35):
        a=Shape();arch(a,2.20,.80,y=y,z=.45,fill=None,lead=False)
        s.poly(a.vertices,a.faces,'limestone')
    for x in (-1.35,1.35):
        a=Shape();arch(a,2.20,.80,z=.45,fill=None,lead=False)
        s.poly([(x+v[1],v[0],v[2]) for v in a.vertices],a.faces,'limestone')
    s.rings((0,0,3.53),[(0,1.75,1.75),(.20,1.6,1.6),(3.35,.035,.035)],'slate',4)
    s.beam((0,0,6.8),(0,0,7.5),.045,'brass')
    s.beam((-.20,0,7.27),(.20,0,7.27),.045,'brass')
    bell.rings((0,0,1.05),[(0,.62,.62),(.12,.58,.58),(.65,.32,.32),(.85,.22,.22),(.90,.10,.10),(.83,.15,.15),(.60,.23,.23),(.1,.48,.48),(0,.53,.53)],'brass',24,False)
    bell.beam((0,0,.99),(0,0,1.8),.045,'iron');bell.ellipsoid((0,0,.98),(.10,.10,.11),'iron')
    bell.beam((-.95,0,2.15),(.95,0,2.15),.10,'oak')
    bell.beam((0,0,1.95),(0,0,2.15),.09,'iron')
    asset('cathedral_belfry_01','01_CATHEDRAL','cathedral_district_kit','敞口钟窗、铜钟与尖顶',{'upper_tower':s,'bell':bell},'ROOF_XY',('X','Y'),notes='仅钟楼上部，底座3.1m。须落在已分配的既有建筑体量内。')
    s=Shape();s.box((0,.06,1.55),(4,.12,3.1),'plaster')
    for x in (-1.93,0,1.93):s.box((x,-.06,1.55),(.17,.18,3.1),'stone')
    for x in (-.95,.95):arch(s,.65,1.05,x=x,z=.8)
    s.box((0,-.12,.15),(4.2,.34,.3),'stone')
    r=Shape();r.pitched_roof(4.3,3.2,1.25,3.1)
    asset('cathedral_annex_01','01_CATHEDRAL','cathedral_district_kit','附属建筑石灰墙面与矮屋顶',{'facade':s,'roof':r},'WALL_XZ',('X','Y'),notes='附楼檐高3.1m，主堂应高于附楼；屋顶部分可独立拆装。')


def fountains():
    for variant in range(2):
        s=Shape();sides=16 if variant==0 else 12
        s.rings((0,0,0),[(0,2,2),(.16,2,2),(.22,1.90,1.90)],'stone',sides)
        s.rings((0,0,.20),[(0,1.90,1.90),(.48,1.90,1.90),(.58,1.96,1.96),(.67,1.96,1.96),(.67,1.65,1.65),(.10,1.65,1.65)],'limestone',sides,False)
        for i in range(sides):
            a=math.tau*(i+.5)/sides
            r=1.885
            s.ellipsoid((r*math.cos(a),r*math.sin(a),.45),(.085,.085,.115),'stone',i)
            if variant:
                s.beam((r*math.cos(a),r*math.sin(a),.32),(r*math.cos(a),r*math.sin(a),.56),.025,'oak_light')
        asset('fountain_basin_0'+str(variant+1),'02_FOUNTAIN','fountain_kit','雕花石池沿 / '+('十六边形' if not variant else '十二边形'),{'carved_basin':s},stretch=('X','Y'),snaps={'MOUNT':(0,0,0),'WATER':(0,0,.48),'ORNAMENT':(0,0,.20)},notes='装配至源f2时底环须逐顶点适配源16边轮廓；不要用外接圆覆盖源占地。')
    s=Shape()
    s.rings((0,0,0),[(0,.53,.53),(.18,.53,.53),(.25,.38,.38),(.55,.27,.27),(1.25,.20,.20),(1.38,.34,.34)],'stone',24)
    for z,rr in ((.23,.38),(.56,.27),(1.25,.22)):s.torus((0,0,z),rr,.045,'limestone')
    s.rings((0,0,1.20),[(0,.22,.22),(.32,.76,.76),(.40,.82,.82),(.46,.78,.78),(.46,.65,.65),(.32,.29,.29)],'limestone',32,False)
    s.rings((0,0,1.53),[(0,.13,.13),(.55,.11,.11),(.64,.03,.03)],'stone',12)
    for i in range(4):
        a=i*math.pi/2
        s.ellipsoid((.26*math.cos(a),.26*math.sin(a),1.06),(.15,.15,.18),'limestone')
        s.beam((.25*math.cos(a),.25*math.sin(a),1.05),(.42*math.cos(a),.42*math.sin(a),1.00),.045,'brass')
    asset('fountain_ornament_01','02_FOUNTAIN','fountain_kit','四面兽首喷口与上层花钵',{'stone_carving':s},'BASIN_XY',snaps={'MOUNT':(0,0,0),'TOP_JET':(0,0,2.15)},notes='底座安装到池盆中心；与water_flow_01配套。')
    s=Shape();jets=Shape();s.rings((0,0,0),[(0,1.64,1.64),(.014,1.64,1.64)],'water',64)
    for i in range(4):
        a=i*math.pi/2
        pts=[]
        for j in range(17):
            t=j/16;r=.4+.8*t
            pts.append((r*math.cos(a),r*math.sin(a),.73+.36*t-1.06*t*t))
        jets.path(pts,.022,'water_light',6)
        s.torus((1.2*math.cos(a),1.2*math.sin(a),.025),.16,.012,'water_light')
    jets.path([(0,0,1.84),(0,0,2.05),(.045,0,2.18),(.11,0,2.19),(.18,0,2.09),(.22,0,1.92)],.023,'water_light')
    for r in (.38,.60,.92,1.40):s.torus((0,0,.025),r,.008,'water_light',64,4)
    asset('water_flow_01','02_FOUNTAIN','fountain_kit','抛物线水束、涟漪与水面',{'surface_and_ripples':s,'water_jets':jets},'WATER_XY',('X','Y'),notes='静态水流网格，不是水体模拟；安装Z=.48。水面按池盆缩放；水束独立跟随喷口缩放。')


def vegetation():
    for k,name in enumerate(('oak','poplar','pine')):
        s=Shape();rng=random.Random(91+k)
        h=(5.4,6.2,6.1)[k]
        s.rings((0,0,0),[(0,.25,.25),(.20,.21,.21),(h*.65,.11,.11),(h*.85,.03,.03)],'oak',10)
        for i in range(5):
            a=i*math.tau/5
            s.beam((0,0,.32),(.48*math.cos(a),.48*math.sin(a),.03),.09,'oak')
        if k==2:
            for j in range(7):
                z=1.5+j*.59;r=1.58*(1-j/8)
                s.rings((0,0,z),[(0,r*.72,r*.72),(.22,r,r),(1.0,.06,.06)],'leaf_dark' if j%2 else 'leaf',11)
                for a in (0,2.1,4.2):s.beam((0,0,z),(.9*r*math.cos(a),.9*r*math.sin(a),z+.12),.04,'oak')
        else:
            for i in range(14 if k==0 else 11):
                a=i*2.39996;z=2.2+i*(.21 if k==0 else .32)
                r=(1.25 if k==0 else .47)*(math.sin((i+2)/18*math.pi))
                p=(math.cos(a)*r,math.sin(a)*r,z)
                s.beam((0,0,z-.6),p,.06 if k==0 else .035,'oak')
                size=(rng.uniform(.65,1.0),rng.uniform(.65,1),rng.uniform(.65,.9)) if k==0 else (.53,.55,.85)
                s.ellipsoid(p,size,'leaf_light' if i%4==0 else 'leaf',i+k*24,10,6,.17)
        asset('tree_'+name+'_01','03_VEGETATION','vegetation_kit',('展开橡树','柱形杨树','层叠松树')[k],{'tree':s},notes='原点位于树干落地中心；按完整树冠bounds避让源grove边界、道路和建筑。')
    for k in range(2):
        s=Shape()
        for i in range(9):
            a=i*2.39996;r=.15+.42*(i%3)/2
            p=(r*math.cos(a),r*math.sin(a),.30+(i%3)*.13)
            s.beam((0,0,.03),p,.023,'oak')
            s.ellipsoid(p,(.34,.32,.35),'leaf' if k==0 else 'leaf_dark',i,9,5,.19)
            if k and i%2==0:
                for j in range(3):s.ellipsoid((p[0]-.16+j*.10,p[1]-.25,p[2]+.05),(.034,.034,.034),'apple',j,8,4)
        asset('shrub_'+('sage' if k==0 else 'berry')+'_01','03_VEGETATION','vegetation_kit',('散生灌木','浆果灌木')[k],{'shrub':s},notes='不代表新增源规划公园；装饰分布须单独记录。')


def farm_and_patriciate():
    for k in range(2):
        s=Shape();r=Shape();width=4.4
        s.box((0,.08,1.55),(width,.16,3.1),'plaster' if not k else 'oak_light')
        for x in (-2.1,0,2.1):s.box((x,-.08,1.55),(.16,.20,3.1),'oak')
        for z in (.17,2.95):s.box((0,-.09,z),(4.4,.20,.17),'oak')
        for i in range(12):
            x=-1.35+(i+.5)*2.7/12
            s.box((x,-.16,1.15),(.21,.09,2.25),'oak_light')
        for x in (-.7,.7):
            for z in (.43,1.93):s.box((x,-.23,z),(1.28,.04,.065),'iron')
            s.beam((x-.55,-.26,.25),(x+.55,-.26,2.05),.055,'oak')
        for x in (-1.94,1.94):
            s.beam((x,-.18,2.95),(x,-1.15,2.5),.07,'oak')
            s.box((x,-1.05,1.2),(.12,.12,2.4),'oak')
        s.box((0,-.62,2.75),(4.7,1.3,.13),'oak_light')
        r.pitched_roof(4.8,4.8,1.8,3.1,'tile' if k==0 else 'oak_light')
        if k:
            for y in (-2.35,2.35):r.beam((0,y,4.90),(0,y,5.25),.065,'oak')
        asset('farm_'+('cottage' if not k else 'barn')+'_01','04_FARM','farm_building_kit',('农舍瓦顶、立面与棚架','仓棚木瓦顶、大门与棚架')[k],{'facade_and_shelter':s,'roof':r},'WALL_XZ',('X','Y'),notes='立面安装Y=0、屋顶檐高3.1；棚架向-Y出挑1.2m，必须做道路和邻栋避让。')
    for k in range(2):
        s=Shape();r=Shape()
        for x in (-1.35,1.35):
            if k:arch(s,1.35,1.1,x=x,z=2.0,pointed=False)
            else:
                s.box((x,-.12,2.8),(1.35,.12,1.55),'glass')
                for xx in (x-.74,x,x+.74):s.box((xx,-.22,2.8),(.10,.18,1.7),'limestone')
                for z in (1.96,2.8,3.64):s.box((x,-.22,z),(1.6,.20,.10),'limestone')
            s.box((x,-.28,1.83),(1.70,.52,.16),'limestone')
        arch(s,1.0,1.15,x=0,pointed=k==0,fill='oak',lead=False)
        for x in (-2.4,2.4):
            s.box((x,-.03,2.1),(.23,.28,4.2),'limestone')
            for z in (.18,3.9):s.box((x,-.09,z),(.4,.4,.18),'stone')
        for z,w in ((4.12,5.15),(4.28,5.4),(4.42,5.6)):
            r.box((0,-.1,z),(w,.60,.13),'limestone')
        for i in range(14):r.box((-2.45+i*.38,-.28,4.0),(.17,.28,.16),'stone')
        asset('patriciate_facade_0'+str(k+1),'05_PATRICIATE','patriciate_building_kit',('富裕住宅十字窗组、入口与齿饰','富裕住宅圆拱窗组、入口与叠檐')[k],{'windows_and_entrance':s,'cornice':r},'WALL_XZ',('X',),notes='4.4m高立面套件，按窗组和檐口拆装，原墙体占地不随此构件变化。')


def roofs_facades():
    for k in range(3):
        s=Shape()
        for i in range(6):
            y=-1.5+(i+.5)*.5
            if k==0:
                s.rings((0,y,0),[(0,.17,.23),(.12,.13,.22)],'tile',10)
            elif k==1:
                s.box((0,y,.1),(.3,.48,.2),'slate')
                s.box((0,y,.23),(.34,.48,.06),'limestone')
            else:
                s.beam((0,y-.25,0),(0,y+.25,0),.11,'oak')
                s.beam((0,y,0),(0,y,.23),.035,'iron')
        for x in (-1.35,1.35):
            s.box((x,0,-.18),(.18,3,.16),'limestone' if k==1 else 'oak')
            for i in range(6):
                y=-1.25+i*.5
                s.beam((x,y,-.18),(x*.87,y,-.42),.05,'oak')
        asset('roof_ridge_eave_0'+str(k+1),'06_ROOF','roof_detail_kit',('陶瓦脊与木檐','石脊与齿饰檐','木脊与铁钉檐')[k],{'ridge_and_eaves':s},'RIDGE_XY',('Y',),snaps={'RIDGE':(0,0,0),'EAVE_LEFT':(-1.35,0,-.18),'EAVE_RIGHT':(1.35,0,-.18)},notes='屋脊与两侧檐条可拆分；统一沿Y重复，坡度由安装规则控制。')
    for k in range(3):
        s=Shape();s.box((0,.12,.60),(1.5,1.3,1.2),'plaster')
        if k==1:
            s.box((0,.15,1.35),(1.8,1.65,.18),'slate')
        else:s.pitched_roof(1.7,1.6,.68,1.2,'slate' if not k else 'tile')
        if k==2:arch(s,.82,.50,y=-.59,z=.25,pointed=False)
        else:
            s.box((0,-.59,.67),(.90,.08,.85),'glass')
            for x in (-.49,0,.49):s.box((x,-.67,.67),(.07,.12,.96),'oak')
            for z in (.18,1.14):s.box((0,-.65,z),(1.1,.15,.09),'oak')
        asset('dormer_0'+str(k+1),'06_ROOF','roof_detail_kit',('山墙屋顶窗','平棚屋顶窗','拱窗屋顶窗')[k],{'dormer':s},'ROOF_XY',('X',),notes='底座中心Z=0，正面-Y。插入屋面后检查背侧与坡面的相交，不直接按墙面装配。')
    for k in range(4):
        s=Shape()
        for x in (-1.5,0,1.5):s.box((x,-.06,1.25),(.13,.15,2.5),'oak')
        for z in (.08,1.25,2.42):s.box((0,-.06,z),(3.12,.16,.14),'oak')
        for sign in (-1,1):
            if k==0:s.beam((sign*1.5,-.07,.2),(0,-.07,2.35),.07,'oak')
            if k==1:
                s.beam((sign*1.5,-.07,.15),(0,-.07,2.35),.06,'oak')
                s.beam((0,-.07,.15),(sign*1.5,-.07,2.35),.06,'oak')
            if k==2:
                for x in (.4,.8,1.2):s.box((sign*x,-.06,1.25),(.07,.12,2.35),'oak')
            if k==3:
                for z in (1.25,2.42):s.beam((sign*1.5,-.07,z-.45),(sign*1.03,-.07,z),.075,'oak')
        for x in (-1.5,0,1.5):
            for z in (.08,1.25,2.42):s.beam((x,-.16,z),(x,-.20,z),.028,'oak_light')
        asset('timber_panel_0'+str(k+1),'07_FACADE','facade_detail_kit',('人字木构','交叉木构','密柱木构','角撑木构')[k],{'timber':s},'WALL_XZ',('X','Z'),notes='3m宽、2.5m高；装饰面在墙面外侧-Y。木构与墙体分别保留。')
    for k in range(6):
        s=Shape()
        if k<3:
            if k==2:arch(s,1.1,1.1,pointed=False)
            else:
                s.box((0,-.08,.85),(1.05,.12,1.35),'glass')
                for x in (-.58,0,.58):s.box((x,-.15,.85),(.09,.18,1.5),'oak')
                for z in (.10,.84,1.6):s.box((0,-.15,z),(1.25,.18,.08),'oak')
                for x in (-.94,.94):
                    s.box((x,-.10,.85),(.52,.10,1.46),'cloth_green' if k==0 else 'oak_light')
                    for z in (.34,1.34):s.box((x,-.18,z),(.48,.055,.055),'iron')
                if k==1:
                    s.box((0,-.35,.15),(1.38,.52,.30),'oak_light')
                    for i in range(5):s.ellipsoid((-.5+i*.25,-.37,.41),(.17,.18,.14),'leaf',i,8,4)
        else:
            if k==4:arch(s,1.35,1.45,pointed=False,fill='oak_light',lead=False)
            elif k==5:arch(s,1.5,1.6,pointed=True,fill='oak',lead=False)
            else:
                s.box((0,-.08,1.05),(1.25,.14,2.1),'oak_light')
                for x in (-.70,.70):s.box((x,-.14,1.1),(.14,.23,2.2),'oak')
                s.box((0,-.14,2.2),(1.55,.23,.17),'oak')
            for x in (-.47,.47):
                for z in (.45,1.50):s.box((x,-.22,z),(.4,.045,.055),'iron')
            s.beam((.35,-.20,1),(.35,-.27,1),.06,'brass')
        asset('opening_0'+str(k+1),'07_FACADE','facade_detail_kit',('窗板十字窗','花箱窗','圆拱窗','平梁木门','圆拱木门','尖拱双扇门')[k],{'opening':s},'WALL_XZ',('X','Z'),notes='墙面Y=0，底部中心Z=0；门窗是独立贴装件，不修改主墙体轮廓。')


def vessel(s,x,y,z,scale=1):
    s.rings((x,y,z),[(0,.16*scale,.16*scale),(.08*scale,.22*scale,.22*scale),(.38*scale,.29*scale,.29*scale),(.58*scale,.13*scale,.13*scale),(.67*scale,.15*scale,.15*scale),(.67*scale,.11*scale,.11*scale),(.58*scale,.09*scale,.09*scale),(.15*scale,.13*scale,.13*scale)],'pottery',16,False)
    pts=[(x+.19*scale+math.sin(i*math.pi/10)*.18*scale,y,z+.50*scale+math.cos(i*math.pi/10)*.17*scale) for i in range(11)]
    s.path(pts,.035*scale,'pottery')


def goods_signs():
    for k in range(4):
        s=Shape()
        s.box((0,0,.08),(1.6,1,.16),'oak_light')
        for x in (-.76,.76):s.box((x,0,.20),(.08,1,.25),'oak')
        if k==0:
            for i in range(7):
                x=-.52+(i%3)*.50;y=-.25+(i//3)*.30
                s.ellipsoid((x,y,.30),(.24,.12,.13),'bread',i,12,5)
                for j in range(3):s.beam((x-.13+j*.12,y-.08,.38),(x-.10+j*.12,y+.07,.40),.014,'linen',4)
            for i in range(4):s.ellipsoid((.5,-.27+i*.16,.53),(.10,.10,.10),'apple',i,10,5)
        elif k==1:
            for i in range(5):vessel(s,-.52+(i%3)*.48,-.22+(i//3)*.44,.16,.8+(i%2)*.20)
        elif k==2:
            for i in range(4):
                s.box((-.38+(i%2)*.77,-.12,.24+(i//2)*.18),(.72,.66,.16),('linen','cloth_blue','cloth_red','cloth_green')[i])
                for j in range(5):s.beam((-.65+(i%2)*.77+j*.11,-.46,.22+(i//2)*.18),(-.65+(i%2)*.77+j*.11,-.50,.18+(i//2)*.18),.009,'linen',4)
        else:
            s.box((-.35,.05,.24),(.45,.27,.13),'iron')
            s.box((-.35,.05,.42),(.7,.34,.13),'iron')
            for i in range(3):
                x=.12+i*.20
                s.beam((x,-.3,.20),(x,.3,.20),.03,'oak')
                s.box((x,.25,.23),(.16,.12,.13),'iron')
                s.path([(x-.06,-.32,.22),(x-.12,-.21,.22),(x-.07,-.12,.22),(x+.07,-.12,.22),(x+.12,-.21,.22),(x+.06,-.32,.22)],.023,'iron')
        asset('goods_'+('food','pottery','cloth','iron')[k]+'_01','08_GOODS_SIGNS','shop_goods_signs',('面包水果货簇','开口陶罐货簇','折叠布匹货簇','铁砧工具货簇')[k],{'goods':s},notes='独立货品簇；底座为陈列托盘，可安装在店面柜台或市场摊位。')
    for k,name in enumerate(('tavern','bakery','smith','draper','cobbler','potter','grocer','warehouse')):
        s=Shape();icon=Shape()
        s.box((.62,.08,.92),(.14,.16,1.84),'oak')
        s.beam((.62,.08,1.80),(-.65,.08,1.80),.06,'iron')
        s.beam((.62,.08,1.10),(-.45,.08,1.80),.035,'iron')
        for x in (-.40,.30):s.beam((x,.04,1.8),(x,.04,1.39),.022,'iron')
        outline=[(-.68,.20),(.50,.20),(.60,.33),(.60,1.23),(.45,1.37),(-.55,1.37),(-.70,1.20)]
        s.panel(outline,0,.10,'oak_light')
        s.path([(x,-.035,z) for x,z in outline+[outline[0]]],.032,'oak')
        yy=-.09
        if k==0:
            icon.box((-.1,yy,.75),(.45,.06,.55),'linen')
            icon.path([(.15,yy,.90),(.34,yy,.90),(.34,yy,.60),(.15,yy,.60)],.04,'linen')
            icon.beam((-.38,yy,1.04),(.16,yy,1.04),.055,'linen')
        elif k==1:
            icon.ellipsoid((-.08,yy,.75),(.43,.04,.22),'bread',0,16,6)
            for x in (-.30,-.06,.18):icon.beam((x-.05,yy-.05,.67),(x+.05,yy-.05,.85),.02,'linen')
        elif k==2:
            icon.panel([(-.5,.82),(.4,.82),(.23,.66),(.05,.63),(.05,.45),(-.25,.45),(-.25,.66)],yy,.05,'iron')
            icon.beam((-.15,yy,1.15),(.19,yy,.84),.028,'linen')
            icon.beam((-.29,yy,1.03),(-.06,yy,1.24),.07,'iron')
        elif k==3:
            icon.panel([(-.43,1.10),(.24,1.10),(.32,.45),(.1,.54),(-.1,.44),(-.30,.53)],yy,.04,'cloth_blue')
            for x in (-.20,0,.16):icon.beam((x,yy-.04,.58),(x-.05,yy-.04,1.03),.012,'linen')
        elif k==4:
            icon.panel([(-.40,.49),(.37,.49),(.40,.64),(.10,.78),(.03,1.13),(-.29,1.13),(-.24,.71),(-.4,.64)],yy,.05,'linen')
        elif k==5:
            icon.panel([(-.34,.45),(.24,.45),(.38,.74),(.15,.93),(.15,1.13),(-.22,1.13),(-.22,.93),(-.43,.74)],yy,.05,'pottery')
        elif k==6:
            for x,z in ((-.24,.68),(.12,.68),(-.05,.96)):
                icon.ellipsoid((x,yy,z),(.16,.04,.16),'apple',0,12,5)
                icon.beam((x,yy,z+.14),(x+.05,yy,z+.24),.019,'leaf')
        else:
            icon.box((-.08,yy,.77),(.69,.06,.64),'linen')
            icon.path([(-.40,yy-.05,.47),(.24,yy-.05,1.07),(-.40,yy-.05,1.07),(.24,yy-.05,.47)],.025,'oak')
        asset('sign_'+name+'_01','08_GOODS_SIGNS','shop_goods_signs','行业图标招牌 / '+name,{'bracket_and_board':s,'raised_icon':icon},'WALL_XZ',notes='无伪文字。实物浮雕图标；安装点为背部支架X=.62,Y=.16，可翻面安装。')


def citizens():
    # Head/torso dimensions are shared; articulated silhouettes differ by pose.
    poses=[('walking',(-.12,0,.46),(.14,-.18,.46),(-.34,-.08,1.03),(.30,.20,1.00)),
           ('merchant',(-.13,0,.45),(.13,0,.45),(-.34,-.20,1.15),(.39,-.36,1.10)),
           ('carrying',(-.14,0,.45),(.14,0,.45),(-.32,-.34,1.12),(.32,-.34,1.12)),
           ('talking',(-.12,0,.45),(.12,0,.45),(-.38,-.24,1.46),(.34,-.07,.98)),
           ('guard',(-.16,0,.45),(.16,0,.45),(-.32,-.08,1.03),(.38,-.05,1.18)),
           ('basket',(-.11,0,.45),(.13,0,.45),(-.43,-.05,.90),(.30,-.10,1.01)),
           ('elder',(-.12,0,.44),(.16,0,.44),(-.33,-.14,.97),(.38,-.20,1.03)),
           ('apprentice',(-.10,.07,.43),(.13,-.18,.43),(-.29,-.23,1.13),(.33,-.28,1.29))]
    for i,(name,lk,rk,lh,rh) in enumerate(poses):
        s=Shape();cloth=('cloth_blue','cloth_red','linen','cloth_green')[i%4]
        s.rings((0,0,.64),[(0,.23,.16),(.36,.18,.13),(.70,.25,.16),(.79,.14,.12)],cloth,10)
        if i in (1,5):s.rings((0,0,.26),[(0,.31,.22),(.46,.22,.17)],cloth,12)
        for side,knee in ((-1,lk),(1,rk)):
            hip=(side*.12,0,.80);ankle=(knee[0],knee[1]+(.11 if i==0 and side<0 else -.04),.10)
            s.beam(hip,knee,.075,'oak_light');s.beam(knee,ankle,.060,'oak_light')
            s.ellipsoid((ankle[0],ankle[1]-.045,.065),(.09,.16,.065),'oak',i,10,4)
        for side,hand in ((-1,lh),(1,rh)):
            shoulder=(side*.22,0,1.30);elbow=(side*.34,(hand[1]+.02)*.55,(hand[2]+1.24)*.5)
            s.beam(shoulder,elbow,.09,cloth);s.beam(elbow,hand,.07,cloth)
            s.ellipsoid(hand,(.066,.07,.07),'skin_light' if i%2 else 'skin',i,10,5)
        s.cylinder((0,0,1.37),.074,.13,'skin',10)
        s.ellipsoid((0,-.01,1.61),(.135,.12,.17),'skin_light' if i%2 else 'skin',i,12,7)
        s.ellipsoid((0,-.126,1.61),(.04,.054,.037),'skin',i,8,4)
        s.rings((0,0,1.71),[(0,.14,.13),(.10,.12,.11),(.14,.02,.02)],'oak' if i%2 else cloth,12)
        s.box((0,-.16,1.0),(.38,.025,.06),'oak')
        s.box((0,-.185,1.0),(.067,.025,.068),'brass')
        if i==1:
            s.panel([(-.14,.70),(.14,.70),(.17,1.27),(-.17,1.27)],-.178,.025,'linen')
            s.ellipsoid((.40,-.40,1.10),(.07,.04,.016),'brass',0,10,4)
        if i==2:
            s.box((0,-.36,1.06),(.58,.38,.43),'oak_light')
            for z in (.9,1.23):s.box((0,-.565,z),(.60,.045,.055),'oak')
        if i==4:
            s.beam((.40,-.05,.04),(.40,-.05,2.25),.025,'oak')
            s.rings((.40,-.05,2.25),[(0,.075,.075),(.27,.003,.003)],'iron',4)
            s.rings((0,0,1.70),[(0,.15,.14),(.14,.10,.10)],'iron',12)
        if i==5:
            s.rings((-.43,-.05,.48),[(0,.15,.13),(.34,.22,.18)],'oak_light',12,False)
            for z in (.54,.64,.74):s.torus((-.43,-.05,z),.18,.014,'oak',16,4)
        if i==6:
            s.beam((.38,-.20,.01),rh,.024,'oak')
            s.rings((0,0,1.68),[(0,.24,.23),(.035,.24,.23),(.05,.13,.13),(.20,.09,.09)],'oak_light',12)
        if i==7:s.box((.02,-.30,1.14),(.29,.10,.40),'cloth_red')
        asset('citizen_'+name+'_01','09_CITIZENS','citizen_poses','市民静态动作 / '+name,{'figure_and_prop':s},notes='静态低模，无骨架；成人头顶约1.85m，面向-Y，双脚落地。8款是变体数，不是场景84个实例。')


def gates_courtyard():
    for k in range(2):
        s=Shape();arch(s,4,3.2,y=-.10,pointed=k==0,fill=None,lead=False)
        for x in (-2.3,2.3):
            s.box((x,.08,2.3),(.5,.55,4.6),'stone')
            for z in (.18,1.4,3.0,4.45):s.box((x,-.04,z),(.68,.70,.20),'limestone')
            s.rings((x,.04,4.7),[(0,.45,.45),(.30,.35,.35),(.90,.02,.02)],'slate',4)
        s.box((0,.08,6.8),(5.1,.50,.20),'limestone')
        for x in (-2,-1,0,1,2):s.box((x,.08,7.05),(.5,.50,.4),'stone')
        s.panel([(-.34,5.45),(.34,5.45),(.32,4.95),(0,4.70),(-.32,4.95)],-.22,.08,'cloth_blue' if k==0 else 'cloth_red')
        asset('gate_arch_trim_0'+str(k+1),'10_GATE','gate_detail_kit',('尖拱门楼石饰','圆拱门楼石饰')[k], {'arch_trim':s},'GATE_XZ',('X',),snaps={'MOUNT':(0,0,0),'CLEARANCE_TOP':(0,0,3.2)},notes='装饰门框，无实心横墙；标准门洞净宽约3.8m，净高至少3.1m，需按源门宽适配。')
    left=Shape();right=Shape();grille=Shape();lamp=Shape()
    # Door leaves opened 90 degrees, beside the passage, with hinge sockets.
    for side,shape in ((-1,left),(1,right)):
        for i in range(8):shape.box((side*2.04,.1+(i+.5)*1.8/8,1.45),(.14,.21,2.9),'oak_light')
        for z in (.35,2.25):
            shape.box((side*2.13,1,z),(.07,1.9,.13),'iron')
            shape.beam((side*2.04,.1,z-.12),(side*2.04,.1,z+.12),.09,'iron')
    for x in [-1.85+i*.37 for i in range(11)]:grille.beam((x,.10,3.30),(x,.10,6.1),.035,'iron')
    for z in (3.50,4.35,5.20,6.0):grille.box((0,.10,z),(3.8,.07,.065),'iron')
    for x in (-2.6,2.6):
        lamp.beam((x,0,2.5),(x,-.45,2.8),.028,'iron')
        lamp.box((x,-.45,2.33),(.26,.22,.42),'glass_amber')
        for xx in (-.15,.15):lamp.beam((x+xx,-.58,2.10),(x+xx,-.58,2.58),.021,'iron')
        lamp.rings((x,-.45,2.57),[(0,.22,.18),(.20,.01,.01)],'iron',4)
    asset('gate_hardware_01','10_GATE','gate_detail_kit','开启门扇、升起铁栅与灯具',{'left_leaf_open':left,'right_leaf_open':right,'portcullis_raised':grille,'lamps':lamp},'GATE_XZ',('X',),snaps={'MOUNT':(0,0,0),'HINGE_LEFT':(-2.04,.1,0),'HINGE_RIGHT':(2.04,.1,0),'GRILLE_LIFT':(0,.10,3.3)},notes='默认门扇旋至通道两侧、铁栅底高3.3m；硬件分别独立对象，可绕铰链调整。')
    for key,title in (('cobble','石路平铺材质'),('earth','夯土平铺材质')):
        s=Shape();s.box((0,0,.015),(2,2,.03),key)
        asset('ground_'+key+'_01','11_COURTYARD','ground_courtyard_kit',title,{'material_sample':s},'GROUND_XY',('X','Y'),notes='2×2m材质样片；使用对应ST材质与纹理贴合源道路，不以方片覆盖规划轮廓。')
    s=Shape()
    for i in range(4):s.box((0,-.24+i*.16,.48),(1.9,.13,.10),'oak_light')
    for x in (-.67,.67):
        for y in (-.20,.20):s.box((x,y,.23),(.11,.11,.46),'oak')
        s.beam((x,.2,.45),(x,.30,1.03),.06,'oak')
    for z in (.76,.96):s.box((0,.30,z),(1.9,.10,.14),'oak_light')
    asset('bench_01','11_COURTYARD','ground_courtyard_kit','木长凳',{'bench':s},notes='长1.9m；安装时用完整bounds避开既有通道。')
    s=Shape()
    for x in (-1.4,1.4):s.box((x,0,.67),(.15,.15,1.34),'oak')
    for z in (.38,.91):s.box((0,0,z),(2.9,.10,.13),'oak')
    for i in range(10):
        x=-1.25+i*2.5/9
        s.box((x,-.04,.65),(.14,.1,1.2),'oak_light')
        s.rings((x,-.04,1.25),[(0,.10,.06),(.12,.002,.002)],'oak_light',4)
    asset('fence_01','11_COURTYARD','ground_courtyard_kit','可重复木篱笆',{'fence':s},'GROUND_XY',('X',),snaps={'LEFT':(-1.4,0,0),'RIGHT':(1.4,0,0)},notes='沿X拼接，端点间距2.8m；装饰围栏不记作源规划城墙。')
    s=Shape()
    for row in range(3):
        for i in range(4-row):
            x=(i-(3-row)/2)*.31;z=.14+row*.25
            s.beam((x,-.58,z),(x,.58,z),.145,'oak',12)
            s.beam((x,-.585,z),(x,-.60,z),.105,'oak_light',12)
            for rr in (.035,.07):
                pts=[(x+rr*math.cos(a*math.tau/14),-.612,z+rr*math.sin(a*math.tau/14)) for a in range(15)]
                s.path(pts,.006,'oak',4)
    asset('firewood_01','11_COURTYARD','ground_courtyard_kit','带年轮柴堆',{'woodpile':s},notes='底部中心落地，独立装饰，不新增源建筑。')


def export_models():
    scene=bpy.data.scenes.new('ST_EXPORT_TEMP')
    old=bpy.context.window.scene
    bpy.context.window.scene=scene
    for entry in ASSETS:
        coll=bpy.data.collections[entry['collection']]
        scene.collection.children.link(coll)
        bpy.context.view_layer.update()
        for ob in scene.objects:ob.select_set(True)
        bpy.ops.export_scene.gltf(filepath=str(OUT/entry['file']),export_format='GLB',
                                  use_selection=True,use_active_scene=True,export_yup=True,export_apply=True,
                                  export_extras=True,export_cameras=False,export_lights=False,
                                  export_animations=False,export_materials='EXPORT')
        path=OUT/entry['file']
        entry['bytes']=path.stat().st_size
        entry['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
        scene.collection.children.unlink(coll)
        print('EXPORTED '+entry['id'],flush=True)
    bpy.context.window.scene=old
    bpy.data.scenes.remove(scene)


def text_object(scene,body,loc,size=.22):
    data=bpy.data.curves.new('Label','FONT');data.body=body;data.size=size;data.align_x='CENTER'
    data.materials.append(MATS['ink'])
    ob=bpy.data.objects.new('Label / '+body,data);scene.collection.objects.link(ob);ob.location=loc
    return ob


def gallery():
    scene=bpy.data.scenes.new('SMALL TOWN / 61 ASSET GALLERY')
    bpy.context.window.scene=scene
    scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences
        for typ in ('OPTIX','CUDA','HIP'):
            try:
                prefs.compute_device_type=typ;prefs.get_devices()
                if any(d.type!='CPU' for d in prefs.devices):
                    for d in prefs.devices:d.use=d.type!='CPU'
                    scene.cycles.device='GPU';break
            except Exception:pass
    except Exception:pass
    scene.world=bpy.data.worlds.new('ST / paper daylight');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.91,.88,.80,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.8
    scene.view_settings.view_transform='Standard';scene.view_settings.look='None'
    sun_data=bpy.data.lights.new('ST / studio sun','SUN');sun_data.energy=2.0;sun_data.angle=.18
    sun=bpy.data.objects.new('ST / studio sun',sun_data);scene.collection.objects.link(sun)
    sun.rotation_euler=(.4,-.5,-.35)
    camera=bpy.data.objects.new('ST / gallery camera',bpy.data.cameras.new('ST / gallery camera'))
    scene.collection.objects.link(camera);scene.camera=camera;camera.data.type='ORTHO'
    camera.data.clip_end=500
    category_groups={}
    for entry in ASSETS:category_groups.setdefault(entry['category'],[]).append(entry)
    visible=[]
    for category_index,(category,entries) in enumerate(category_groups.items()):
        block_x=(category_index%3)*32
        block_y=-(category_index//3)*28
        for i,e in enumerate(entries):
            col=i%4;r=i//4
            dims=e['dimensions'];scale=min(1.6,4.6/max(dims))
            ob=bpy.data.objects.new('DISPLAY / '+e['id'],None)
            ob.instance_type='COLLECTION';ob.instance_collection=bpy.data.collections[e['collection']]
            scene.collection.objects.link(ob)
            center=[(e['bounds']['min'][j]+e['bounds']['max'][j])/2 for j in range(3)]
            ob.location=(block_x+col*7-center[0]*scale,block_y-r*7-center[1]*scale,.12-e['bounds']['min'][2]*scale)
            ob.scale=(scale,)*3;ob['display_scale_only']=True
            e['galleryPosition']=list(ob.location);e['galleryScale']=scale
            visible.append(ob)
            label=e['id'].replace('_01','').replace('_',' ')
            text_object(scene,label,(block_x+col*7,block_y-r*7-2.4,.06),.22)
        text_object(scene,category.replace('_',' '),(block_x+10.5,block_y+3.2,.08),.55)
    ground=Shape();ground.box((43,-42,-.1),(98,110,.2),'paper')
    data=ground.create_mesh('Gallery paper');ob=bpy.data.objects.new('Gallery paper',data);scene.collection.objects.link(ob)
    scene.render.resolution_x=2600;scene.render.resolution_y=2800
    scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
    focus=Vector((43,-42,1.3))
    camera.location=focus+Vector((8,-40,100));camera.rotation_euler=(focus-camera.location).to_track_quat('-Z','Y').to_euler()
    bpy.context.view_layer.update()
    camera.data.ortho_scale=110
    scene.render.use_freestyle=True
    fs=scene.view_layers[0].freestyle_settings
    ls=fs.linesets[0] if fs.linesets else fs.linesets.new('Ink contours')
    ls.select_crease=False;ls.select_silhouette=True;ls.select_border=True
    ls.linestyle.color=(.13,.11,.08);ls.linestyle.thickness=.7;ls.linestyle.alpha=.72
    scene['library_asset_count']=len(ASSETS)
    scene['gallery_note']='Display instances are scaled for inspection; source collections and GLB use metric units.'
    # Native pigment/line renderer; portable exported assets keep plain PBR textures.
    scene.render.filepath=str(OUT/'previews'/'all-assets.png')
    for area in bpy.context.screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.clip_end=1000
            area.spaces.active.shading.color_type='MATERIAL'
    return scene,category_groups


def write_manifest():
    gap=json.loads((HERE.parents[1]/'artifacts'/'3d-small-town'/'asset-gap-list.json').read_text(encoding='utf-8-sig'))
    manifest={'schemaVersion':1,'title':'Small Town / authored modular assets',
              'units':'meters','blenderAxes':{'up':'+Z','front':'-Y','wall':'XZ at Y=0'},
              'glTFConvention':'glTF +Y up; Blender exporter converts axes. Reimport with standard glTF importer.',
              'materialSlots':list(PALETTE),'textures':'textures/*.png, packed in .blend and embedded in each GLB',
              'assetCount':len(ASSETS),'assets':ASSETS,
              'scope':'All 11 P0/P1 groups in 3d-small-town/asset-gap-list.json. P2 absent/optional categories excluded.',
              'sceneIntegration':'Default renderer imports these collections. Integrated town is saved separately; historic scene remains unchanged.',
              'rendererIntegration':{'entry':'experiments/3d-sample/render_sample_v2.py','defaultEnabled':True,
                                     'reportFile':'asset-integration.json','example':'../3d-small-town-assets/'},
              'requirements':[],'sourceGapListSha256':hashlib.sha256((HERE.parents[1]/'artifacts'/'3d-small-town'/'asset-gap-list.json').read_bytes()).hexdigest()}
    for g in gap['gaps']:
        if g['priority']=='P2':continue
        entries=[e for e in ASSETS if e['gapId']==g['assetId']]
        expected=sum(m.get('variants',0) for m in g['modules'])
        manifest['requirements'].append({'gapId':g['assetId'],'priority':g['priority'],'requiredVariants':expected,
                                          'deliveredVariants':len(entries),'assetIds':[e['id'] for e in entries],
                                          'state':'authored_3d_kit','integratedInHistoricScene':False})
        assert len(entries)==expected,(g['assetId'],expected,len(entries))
    (OUT/'asset-library.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')


def build(render=False):
    if bpy.data.collections.get('cathedral_roof_01'):
        raise RuntimeError('This library already exists in the current file. Open a fresh file before rebuilding.')
    make_materials()
    church();fountains();vegetation();farm_and_patriciate();roofs_facades();goods_signs();citizens();gates_courtyard()
    assert len(ASSETS)==61,len(ASSETS)
    export_models()
    scene,groups=gallery()
    from illustration_v2 import apply_illustration
    # Only the task's materials, not materials in the user's other scene.
    prior={m:m.get('illustration_v2') for m in bpy.data.materials if not m.name.startswith('ST / ')}
    for mat in prior:mat['illustration_v2']=True
    MATS['paper']['illustration_v2']=True
    apply_illustration(scene)
    for mat,value in prior.items():
        if value is None:del mat['illustration_v2']
        else:mat['illustration_v2']=value
    write_manifest()
    scene['build_script']=str(Path(__file__).resolve())
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'small-town-asset-library.blend'))
    print('LIBRARY_READY: '+str(OUT),flush=True)
    if render:bpy.ops.render.render(write_still=True)


if __name__=='__main__':
    build(render='--render' in sys.argv)
