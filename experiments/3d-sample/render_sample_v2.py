"""Build an editable, footprint-faithful medieval market study in Blender.

Run with Blender --background --factory-startup --python this_file -- --preview
All horizontal coordinates come directly from selection.json, in map metres.
"""
import bpy, sys, os, json, math, random, hashlib, argparse, copy
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

HERE = Path(__file__).resolve().parent
BASE = HERE.parent.parent / 'artifacts' / '3d-sample'
import shutil
sys.path.insert(0, str(HERE))
args = argparse.ArgumentParser()
args.add_argument('--input-dir', type=Path, default=BASE)
args.add_argument('--output-dir', type=Path, default=BASE/'v2')
args.add_argument('--name', default='market-quarter')
args.add_argument('--resolution', type=int, default=3200)
args.add_argument('--frame-entities', action='store_true', help='Fit plan entities instead of the empty ground extent.')
args.add_argument('--preview', action='store_true')
args.add_argument('--no-props', action='store_true')
args.add_argument('--angle', type=float, default=225)
args.add_argument('--elevation', type=float, default=48)
args.add_argument('--plan-scale', type=float, default=.5)
args.add_argument('--asset-library', type=Path, help='Authored .blend library; defaults to artifacts/small-town-assets.')
args.add_argument('--legacy-assets', action='store_true', help='Use the earlier procedural components for comparison.')
opts = args.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
OUT = opts.output_dir.resolve()
OUT.mkdir(parents=True, exist_ok=True)
for source_name in ('selection.json','source-town.json'):
    source_path = (opts.input_dir/source_name).resolve()
    if source_path != OUT/source_name:
        shutil.copy2(source_path, OUT/source_name)
source_data = json.loads((OUT / 'selection.json').read_text(encoding='utf-8-sig'))
data = copy.deepcopy(source_data)
def scale_points(value):
    if isinstance(value,dict):
        if 'x' in value and 'y' in value:
            value['x']*=opts.plan_scale;value['y']*=opts.plan_scale
        else:
            for child in value.values():scale_points(child)
    elif isinstance(value,list):
        for child in value:scale_points(child)
scale_points(data)
for road in data['roads']:road['width']*=opts.plan_scale
for feat,src in zip(data.get('features',[]),source_data.get('features',[])):feat['source_points']=src['points']
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for old in list(bpy.data.collections):
    if old.name != 'Collection': bpy.data.collections.remove(old)

def collection(name):
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name); bpy.context.scene.collection.children.link(c)
    return c

def put(obj, coll):
    for c in list(obj.users_collection): c.objects.unlink(obj)
    collection(coll).objects.link(obj)
    return obj

def mesh(name, verts, faces, mat, coll='01_BUILDINGS', uv=None):
    m = bpy.data.meshes.new(name); m.from_pydata(verts, [], faces); m.update()
    o = bpy.data.objects.new(name, m); collection(coll).objects.link(o)
    if mat: m.materials.append(mat)
    if uv:
        layer = m.uv_layers.new(name='MetreUV')
        for p, coords in zip(m.polygons, uv):
            for idx, co in zip(p.loop_indices, coords): layer.data[idx].uv = co
    return o

def material(name, color, brick=None):
    m = bpy.data.materials.new(name); m.diffuse_color = (*color, 1); m.use_nodes = True
    n=m.node_tree.nodes; l=m.node_tree.links; p=n.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=.92
    p.inputs['Specular IOR Level'].default_value=.08
    if brick:
        tex=n.new('ShaderNodeTexBrick'); uv=n.new('ShaderNodeTexCoord')
        l.new(uv.outputs['UV'],tex.inputs['Vector'])
        tex.inputs['Scale'].default_value=1
        tex.inputs['Color1'].default_value=(*color,1)
        tex.inputs['Color2'].default_value=(*(min(1,c*1.07) for c in color),1)
        tex.inputs['Mortar'].default_value=(.24,.225,.20,1)
        tex.inputs['Mortar Size'].default_value=brick[2]
        tex.inputs['Mortar Smooth'].default_value=.004
        tex.inputs['Brick Width'].default_value=brick[0]
        tex.inputs['Row Height'].default_value=brick[1]
        l.new(tex.outputs['Color'],p.inputs['Base Color'])
    return m

M = {
 'ink':material('Warm graphite',(.085,.075,.063)),
 'timber':material('Weathered oak',(.27,.205,.135)),
 'plaster':material('Lime plaster',(.79,.755,.66)),
 'stone':material('Limestone / hand ruled joints',(.66,.65,.60),(.85,.43,.025)),
 'stone_plain':material('Cut limestone',(.64,.625,.56)),
 'roof_slate':material('Pale slate / tile courses',(.49,.53,.535),(.62,.34,.020)),
 'roof_ochre':material('Ochre tile / tile courses',(.62,.48,.315),(.60,.32,.020)),
 'canvas':material('Linen ochre',(.72,.54,.34)),
 'canvas_cream':material('Undyed linen',(.89,.83,.69)),
 'ground':material('Warm parchment ground',(.82,.765,.64)),
 'road':material('Worn pale earth',(.88,.835,.73)),
 'metal':material('Dark iron',(.19,.20,.19)),
 'glass':material('Window recess',(.13,.155,.15)),
}
plasters=[material('Plaster variation %02d'%i,c) for i,c in enumerate([
 (.83,.80,.71),(.76,.735,.66),(.79,.75,.635),(.86,.82,.73),(.73,.74,.69)])]

class Batch:
    def __init__(self,name,mat,coll='01_BUILDINGS'):
        self.name=name; self.mat=mat; self.coll=coll; self.v=[]; self.f=[]
    def box(self,center,axes,dimensions):
        c=Vector(center); a=[Vector(x) for x in axes]; dx,dy,dz=[d/2 for d in dimensions]
        off=len(self.v)
        for x,y,z in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),(1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]:
            self.v.append(tuple(c+a[0]*dx*x+a[1]*dy*y+a[2]*dz*z))
        self.f.extend([tuple(off+i for i in face) for face in [(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)]])
    def beam(self,a,b,width,depth=None):
        a,b=Vector(a),Vector(b); v=b-a
        if v.length<1e-6:return
        z=v.normalized(); ref=Vector((0,0,1)) if abs(z.z)<.95 else Vector((1,0,0))
        x=z.cross(ref).normalized(); y=z.cross(x).normalized()
        self.box((a+b)/2,(x,y,z),(width,depth or width,v.length))
    def finish(self):
        return mesh(self.name,self.v,self.f,self.mat,self.coll) if self.v else None

def points(raw):return [(p['x'],p['y']) if isinstance(p,dict) else tuple(p[:2]) for p in raw]
def signed_area(poly):return sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(poly,poly[1:]+poly[:1]))/2
def poly_area(poly):return abs(signed_area(poly))
def center(poly):return (sum(p[0] for p in poly)/len(poly),sum(p[1] for p in poly)/len(poly))
def inside(q,poly):
    hit=False
    for a,b in zip(poly,poly[1:]+poly[:1]):
        if (a[1]>q[1])!=(b[1]>q[1]) and q[0]<(b[0]-a[0])*(q[1]-a[1])/(b[1]-a[1])+a[0]:hit=not hit
    return hit
def rng_for(s):return random.Random(int(hashlib.sha256(s.encode()).hexdigest()[:12],16))
def clip(poly, n, c, positive):
    result=[]
    for a,b in zip(poly,poly[1:]+poly[:1]):
        da=a[0]*n[0]+a[1]*n[1]-c; db=b[0]*n[0]+b[1]*n[1]-c
        inside=lambda d: d>=-1e-8 if positive else d<=1e-8
        if inside(da):result.append(a)
        if inside(da)!=inside(db):
            t=da/(da-db); result.append((a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])))
    return result

def extrude(name,poly,z0,z1,mat,coll):
    n=len(poly); verts=[(x,y,z0) for x,y in poly]+[(x,y,z1) for x,y in poly]
    faces=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]; uv=[poly,poly]
    for i in range(n):
        j=(i+1)%n; d=math.dist(poly[i],poly[j]); faces.append((i,j,j+n,i+n));uv.append([(0,z0),(d,z0),(d,z1),(0,z1)])
    return mesh(name,verts,faces,mat,coll,uv)

api = {k:globals()[k] for k in ('mesh','Batch','M','plasters','points','signed_area','poly_area','center','inside','rng_for','clip','extrude','collection')}
asset_library=None
if not opts.legacy_assets:
    from asset_integration import AssetLibrary, DEFAULT_LIBRARY
    asset_library=AssetLibrary(opts.asset_library or DEFAULT_LIBRARY)
    api['assetLibrary']=asset_library
from buildings_v2 import build_buildings
build_records=build_buildings(data,api)
if asset_library:asset_library.architecture(data,build_records)
print('V2 buildings:',len(build_records),flush=True)

# The crop is an explicit extraction of the plan, never a rearrangement.
crop=points(data['cropPolygon']);extrude('Study_ground',crop,-.8,0,M['ground'],'00_GROUND')
land_materials={
    'Farm':material('Planned farm land / dry ochre wash',(.76,.735,.58)),
    'Park':material('Planned park land / sage wash',(.69,.72,.58)),
}
for district in data['districts']:
    if district['wardType']=='Market':extrude('Original_market_square',points(district['points']),.005,.025,M['road'],'00_GROUND')
    elif data.get('scope')=='whole-city' and district['wardType'] in land_materials:
        land=extrude('Original_land_'+district['id'],points(district['points']),.001,.003,land_materials[district['wardType']],'00_GROUND')
        land['source_district_id']=district['id'];land['asset_kind']='planned_land_use'
for road in data['roads']:
    rp=points(road['points']);w=road['width']
    verts=[];faces=[]
    for a,b in zip(rp,rp[1:]):
        d=math.dist(a,b)
        if d<.001:continue
        nx=-(b[1]-a[1])/d*w/2;ny=(b[0]-a[0])/d*w/2;k=len(verts)
        verts.extend([(a[0]+nx,a[1]+ny,.035),(a[0]-nx,a[1]-ny,.035),(b[0]-nx,b[1]-ny,.035),(b[0]+nx,b[1]+ny,.035)])
        faces.append((k,k+1,k+2,k+3))
    mesh('Original_road_'+road['id'],verts,faces,M['road'],'00_GROUND')

def wall_span(a,b,name,height=12.0,base=0.0):
    d=math.dist(a,b)
    if d<.1:return
    u=Vector(((b[0]-a[0])/d,(b[1]-a[1])/d,0));v=Vector((-u.y,u.x,0));th=2.5
    p=[(a[0]+v.x*th/2,a[1]+v.y*th/2),(a[0]-v.x*th/2,a[1]-v.y*th/2),(b[0]-v.x*th/2,b[1]-v.y*th/2),(b[0]+v.x*th/2,b[1]+v.y*th/2)]
    extrude(name,p,base,height,M['stone'],'02_CITY_WALL')
    batt=Batch(name+'_merlons',M['stone_plain'],'02_CITY_WALL')
    count=max(1,int(d/3.5))
    for j in range(count):
        t=(j+.5)/count;z=height+.85
        batt.box((a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,z),(u,v,Vector((0,0,1))),(1.65,th+.25,1.7))
    batt.finish()
    rim=Batch(name+'_coping',M['stone_plain'],'02_CITY_WALL')
    rim.box(((a[0]+b[0])/2,(a[1]+b[1])/2,height-.20),(u,v,Vector((0,0,1))),(d,th+.40,.40));rim.finish()

wall_stats=[]
gate_mounts=[]
for wall in data['walls']:
    p=points(wall['points']);gates=points(wall.get('gatePoints',[]));active=wall.get('activeSegments',[True]*len(p))
    # Castle gates can be explicit vertices with both adjoining spans active.
    # Keep their source centerlines, but bridge the opening above walking height.
    explicit_gates={}
    for g in gates:
        idx=min(range(len(p)),key=lambda j:math.dist(g,p[j]))
        if math.dist(g,p[idx])<1e-5 and active[idx] and active[(idx-1)%len(p)]:
            explicit_gates[idx]=min(3.0,math.dist(g,p[(idx-1)%len(p)]),math.dist(g,p[(idx+1)%len(p)]))
    segment_pairs=list(zip(p,p[1:]+p[:1])) if wall.get('closed',True) else list(zip(p,p[1:]))
    for i,(a,b) in enumerate(segment_pairs):
        if i>=len(active) or not active[i]:continue
        d=math.dist(a,b)
        if d<.01:continue
        # Inactive city-wall gaps stay unchanged. Explicit castle gates retain
        # full wall coverage above the opening rather than filling it at ground.
        cuts={0.,1.}
        start=explicit_gates.get(i,0)/d;end=1-explicit_gates.get((i+1)%len(p),0)/d
        cuts.update((max(0.,min(1.,start)),max(0.,min(1.,end))))
        cuts=sorted(cuts);intervals=list(zip(cuts,cuts[1:]))
        for j,(lo,hi) in enumerate(intervals):
            aa=(a[0]+(b[0]-a[0])*lo,a[1]+(b[1]-a[1])*lo);bb=(a[0]+(b[0]-a[0])*hi,a[1]+(b[1]-a[1])*hi)
            base=4.4 if (lo+hi)/2<start or (lo+hi)/2>end else 0.
            wall_span(aa,bb,wall['id']+'_segment_%d_%d'%(i,j),base=base);wall_stats.append([aa,bb])
    for i,q in enumerate(points(wall.get('towerPoints',[]))):
        radius=min([4.3]+[math.dist(q,g)*.45 for g in gates]);tower_scale=radius/4.3
        sides=12;poly=[(q[0]+radius*math.cos(t*2*math.pi/sides),q[1]+radius*math.sin(t*2*math.pi/sides)) for t in range(sides)]
        extrude(wall['id']+'_tower_'+str(i),poly,0,16.7,M['stone'],'02_CITY_WALL')
        ring=Batch(wall['id']+'_tower_crenels_'+str(i),M['stone_plain'],'02_CITY_WALL')
        for t in range(12):
            ang=t*math.tau/12;u=Vector((-math.sin(ang),math.cos(ang),0));v=Vector((math.cos(ang),math.sin(ang),0))
            ring.box((q[0]+3.95*tower_scale*v.x,q[1]+3.95*tower_scale*v.y,17.35),(u,v,Vector((0,0,1))),(1.35*tower_scale,1.15*tower_scale,1.65))
        ring.finish()
        # Dark arrow loops on outward-facing tower facets.
        slots=Batch(wall['id']+'_arrowloops_'+str(i),M['glass'],'02_CITY_WALL')
        for ang in [math.pi/6+j*math.tau/6 for j in range(6)]:
            u=Vector((-math.sin(ang),math.cos(ang),0));v=Vector((math.cos(ang),math.sin(ang),0))
            for zz in (6.0,11.3):slots.box((q[0]+4.18*tower_scale*v.x,q[1]+4.18*tower_scale*v.y,zz),(u,v,Vector((0,0,1))),(.30*tower_scale,.10*tower_scale,1.6))
        slots.finish()
    for i,g in enumerate(gates):
        # Find the original contiguous inactive chain containing this gate.
        idx=min(range(len(p)),key=lambda j:math.dist(g,p[j]));lo=idx;hi=idx
        closed=wall.get('closed',True)
        for _ in range(len(p)):
            prev=(lo-1)%len(p) if closed else lo-1
            if prev<0 or prev>=len(active) or active[prev]:break
            lo=prev
        for _ in range(len(p)):
            if hi>=len(active) or active[hi]:break
            hi=(hi+1)%len(p) if closed else hi+1
        if hi==lo:continue
        near=(p[lo],p[hi]);dd=math.dist(*near);u=Vector(((near[1][0]-near[0][0])/dd,(near[1][1]-near[0][1])/dd,0));v=Vector((-u.y,u.x,0));gc=((near[0][0]+near[1][0])/2,(near[0][1]+near[1][1])/2)
        gate_mounts.append({'wallId':wall.get('sourceId',wall['id']),'index':i,'sourcePoint':list(g),
                            'origin':list(gc),'width':dd,'along':[u.x,u.y],'normal':[v.x,v.y]})
        box=Batch('Gate_'+wall['id']+str(i),M['stone_plain'],'02_CITY_WALL')
        box.box((gc[0],gc[1],10.9),(u,v,Vector((0,0,1))),(dd+2.2,3.3,3.3))
        for dx in (-dd/2-1.05,dd/2+1.05):box.box((gc[0]+dx*u.x,gc[1]+dx*u.y,7.3),(u,v,Vector((0,0,1))),(2.1,4.0,14.6))
        box.finish()
        av=[];af=[];au=[]
        # Voussoir panels form a real open arch, with no surface across the passage.
        for k in range(18):
            x0=-dd/2+dd*k/18;x1=-dd/2+dd*(k+1)/18
            z0=4.4+4.5*math.sqrt(max(0,1-(x0/(dd/2))**2));z1=4.4+4.5*math.sqrt(max(0,1-(x1/(dd/2))**2))
            quad=[(x0,z0),(x1,z1),(x1,10.0),(x0,10.0)];ix=len(av)
            for depth in (-1.65,1.65):
                av.extend([tuple(Vector((gc[0],gc[1],zz))+u*xx+v*depth) for xx,zz in quad])
            for face in [(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)]:af.append(tuple(ix+j for j in face))
        mesh('Gate_arch_'+wall['id']+str(i),av,af,M['stone_plain'],'02_CITY_WALL')
print('Built wall spans:',len(wall_stats),flush=True)

props={}
if not opts.no_props and data.get('plaza'):
    from props import build_market
    props=build_market(points(data['plaza']['points']),[points(b['points']) for b in data['buildings']],data['roads'],M,seed=7,features=data.get('features',[]),authored_assets=bool(asset_library))
    print('Market life:',props,flush=True)

from planning_features import build_planning_features
feature_stats=build_planning_features(data,api)
print('Planning features:',feature_stats,flush=True)

from shopfronts_v2 import build_shopfronts
shop_stats=build_shopfronts(data,build_records,api)
print('Shopfronts:',shop_stats,flush=True)
asset_stats={'enabled':False}
if asset_library:
    asset_stats=asset_library.decorate(data,build_records,feature_stats,props,shop_stats,gate_mounts)
    (OUT/'asset-integration.json').write_text(json.dumps(asset_stats,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Authored assets:',asset_stats['usedVariants'],'variants;',asset_stats['meshPlacements'],'meshes;',len(asset_stats['skippedMounts']),'skipped mounts',flush=True)
from illustration_v2 import apply_illustration
illustration_stats=apply_illustration(bpy.context.scene)
print('Illustration:',illustration_stats,flush=True)
# Native pigment and ink treatment; all plan geometry is retained.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24 if opts.preview else 64
scene.cycles.use_denoising=True
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.get_devices()
    for backend in ('OPTIX','CUDA'):
        try:
            prefs.compute_device_type=backend;prefs.get_devices()
            gpu=[d for d in prefs.devices if d.type!='CPU']
            if gpu:
                for dev in prefs.devices:dev.use=dev.type!='CPU'
                scene.cycles.device='GPU';break
        except Exception:pass
except Exception:pass
world=bpy.data.worlds.new('Paper daylight');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.88,.88,.84,1);world.node_tree.nodes['Background'].inputs[1].default_value=1.0;scene.world=world
wn=world.node_tree.nodes;wl=world.node_tree.links
paper=wn.new('ShaderNodeBackground');paper.inputs[0].default_value=(.965,.953,.922,1);paper.inputs[1].default_value=1
lightpath=wn.new('ShaderNodeLightPath');wmix=wn.new('ShaderNodeMixShader')
wl.new(lightpath.outputs['Is Camera Ray'],wmix.inputs[0]);wl.new(wn['Background'].outputs[0],wmix.inputs[1]);wl.new(paper.outputs[0],wmix.inputs[2]);wl.new(wmix.outputs[0],wn['World Output'].inputs[0])
light=bpy.data.lights.new('Soft morning sun','SUN');light.energy=1.55;light.angle=math.radians(12)
sun=bpy.data.objects.new('Soft morning sun',light);scene.collection.objects.link(sun);sun.rotation_euler=(math.radians(25),math.radians(-30),math.radians(-25))
scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
scene.render.resolution_x=1500 if opts.preview else opts.resolution;scene.render.resolution_y=1500 if opts.preview else opts.resolution;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.film_transparent=False
camdata=bpy.data.cameras.new('Axonometric camera');cam=bpy.data.objects.new('Axonometric camera',camdata);scene.collection.objects.link(cam);scene.camera=cam
camdata.type='ORTHO';c=Vector((*center(crop),5));az=math.radians(opts.angle);el=math.radians(opts.elevation)
direction=Vector((math.cos(az)*math.cos(el),math.sin(az)*math.cos(el),math.sin(el)))
cam.location=c+direction*550;cam.rotation_euler=(c-cam.location).to_track_quat('-Z','Y').to_euler();camdata.clip_end=2000
bpy.context.view_layer.update()
allpts=[]
for ob in scene.objects:
    if ob.type=='MESH' and not (opts.frame_entities and ob.name=='Study_ground'):
        allpts.extend([ob.matrix_world@v.co for v in ob.data.vertices])
inv=cam.matrix_world.inverted();proj=[inv@p for p in allpts];minx=min(p.x for p in proj);maxx=max(p.x for p in proj);miny=min(p.y for p in proj);maxy=max(p.y for p in proj)
shift=cam.matrix_world.to_3x3()@Vector(((minx+maxx)/2,(miny+maxy)/2,0));cam.location+=shift
camdata.ortho_scale=max(maxx-minx,maxy-miny)*1.08
scene.render.use_freestyle=True
fs=scene.view_layers[0].freestyle_settings
lines=fs.linesets[0] if fs.linesets else fs.linesets.new('Architectural contour')
lines.select_silhouette=True;lines.select_border=True;lines.select_crease=False
lines.select_edge_mark=False;lines.select_material_boundary=False
fs.crease_angle=math.radians(105)
style=lines.linestyle;style.color=(.065,.058,.048);style.thickness=1.05 if opts.preview else 2.25;style.alpha=.94
noise=style.geometry_modifiers.new('Subtle nib variation','SPATIAL_NOISE');noise.amplitude=.25 if opts.preview else .55;noise.scale=7;noise.octaves=2
seams=fs.linesets.new('Fine structural seams');seams.select_silhouette=False;seams.select_border=False;seams.select_crease=True
seams.select_edge_mark=False;seams.select_material_boundary=False
seams.linestyle.color=(.20,.175,.14);seams.linestyle.thickness=.55 if opts.preview else 1.15;seams.linestyle.alpha=.8
ink_collection=None
if asset_library:
    # Dense facade joinery already carries dark wood and surface hatching.
    # Trace the architectural silhouettes once, instead of reconstructing
    # thousands of small window/timber meshes in Freestyle.
    ink_collection=collection('07_INK_OUTLINES')
    fine_roles={'timber_panel','house_window','house_entrance','cathedral_window','cathedral_entrance',
                'special_facade','patriciate_cornice','ridge_detail','shop_goods','shop_sign','market_goods','planned_ground_material'}
    for obj in list(scene.objects):
        if obj.type=='MESH' and not obj.get('authored_asset_id') and obj.name!='Study_ground' and not obj.name.startswith(('Original_road_','Original_land_','Planning_grove_')) and obj.name!='Original_market_square' and obj.get('asset_mount_role') not in fine_roles:
            ink_collection.objects.link(obj)
for line_set in (lines,seams):
    # Road ribbons overlap at junctions; their mesh borders are construction seams,
    # not inked architectural features. Preserve them in geometry, omit their ink.
    line_set.select_by_collection=True
    line_set.collection=ink_collection or collection('00_GROUND')
    line_set.collection_negation='INCLUSIVE' if ink_collection else 'EXCLUSIVE'
scene.render.line_thickness=1.0
if asset_library:
    scene['authored_ink_overlay']=True
    scene.render.use_freestyle=False
scene.render.filepath=str(OUT/('render-preview.png' if opts.preview else opts.name+'-render.png'))
scene['source_selection']='selection.json';scene['structure_policy']='Exact building wall footprints and original plan roads; vertical architecture is designed.'
scene['building_count']=len(build_records);scene['sample_seed']=data.get('seed',7)
if asset_library:
    helper=bpy.data.texts.get('render_pipeline.py') or bpy.data.texts.new('render_pipeline.py')
    helper.clear();helper.write((HERE/'render_pipeline.py').read_text(encoding='utf-8'))
    entry=bpy.data.texts.get('Render with ink.py') or bpy.data.texts.new('Render with ink.py')
    entry.clear();entry.write("import bpy\nfrom pathlib import Path\nscope = {'__name__': 'embedded_ink_renderer'}\nexec(bpy.data.texts['render_pipeline.py'].as_string(), scope)\nbpy.context.scene.render.filepath = str(Path(bpy.data.filepath).with_name('render-with-ink.png'))\nscope['render_with_ink'](bpy.context.scene)\n")
(OUT/'scene-manifest.json').write_text(json.dumps({'buildings':build_records,'wallSpans':wall_stats,'props':props,'planningFeatures':feature_stats,'shopfronts':shop_stats,'assetIntegration':asset_stats,'illustration':illustration_stats,'revision':'v3-assets' if asset_library else 'v2','scope':data.get('scope','selection'),'camera':{'azimuth':opts.angle,'elevation':opts.elevation},'source':data.get('source'),'horizontalScale':opts.plan_scale,'notes':'All plan XY coordinates and road widths receive the same reversible uniform scale. Building wall footprints are exact under inverse mapping; floors, facades, roofs and props are designed interpretations.'},ensure_ascii=False,indent=2),encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(opts.name+'.blend')))
print('Rendering',scene.render.filepath,scene.cycles.device,flush=True)
from render_pipeline import render_with_ink
render_with_ink(scene)
print('FINISHED',flush=True)
