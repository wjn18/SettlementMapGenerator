"""Build an editable, footprint-faithful medieval market study in Blender.

Run with Blender --background --factory-startup --python this_file -- --preview
All horizontal coordinates come directly from selection.json, in map metres.
"""
import bpy, sys, os, json, math, random, hashlib, argparse, copy
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

HERE = Path(__file__).resolve().parent
OUT = HERE.parent.parent / 'artifacts' / '3d-sample'
sys.path.insert(0, str(HERE))
args = argparse.ArgumentParser()
args.add_argument('--preview', action='store_true')
args.add_argument('--no-props', action='store_true')
args.add_argument('--angle', type=float, default=225)
args.add_argument('--elevation', type=float, default=48)
args.add_argument('--plan-scale', type=float, default=.5)
opts = args.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
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

build_records=[]
for b in data['buildings']:
    p=points(b['points']); p=p if signed_area(p)>0 else list(reversed(p)); r=rng_for(b['id'])
    # Pick the longest side; the ridge is aligned to the long dimension.
    edge=max(zip(p,p[1:]+p[:1]),key=lambda e:math.dist(*e))
    u=Vector((edge[1][0]-edge[0][0],edge[1][1]-edge[0][1]));u.normalize();v=Vector((-u.y,u.x))
    us=[x*u.x+y*u.y for x,y in p]; vs=[x*v.x+y*v.y for x,y in p]
    if max(vs)-min(vs)>max(us)-min(us):u,v=v,-u;us=[x*u.x+y*u.y for x,y in p];vs=[x*v.x+y*v.y for x,y in p]
    mid=(min(vs)+max(vs))/2; half=(max(vs)-min(vs))/2
    floors=2 if r.random()<.62 else 3
    eave=floors*3.25+r.uniform(-.25,.4); rise=min(half*.80,9.5)
    def roofz(q):return eave+rise*max(0,1-abs(q[0]*v.x+q[1]*v.y-mid)/max(.1,half))
    split=[]
    for a,c in zip(p,p[1:]+p[:1]):
        split.append(a); da=a[0]*v.x+a[1]*v.y-mid; dc=c[0]*v.x+c[1]*v.y-mid
        if da*dc< -1e-9:
            t=da/(da-dc);split.append((a[0]+t*(c[0]-a[0]),a[1]+t*(c[1]-a[1])))
    n=len(split); verts=[(x,y,.08) for x,y in split]+[(x,y,roofz((x,y))) for x,y in split]
    faces=[tuple(range(n-1,-1,-1))];uv=[split]
    for i in range(n):
        j=(i+1)%n;d=math.dist(split[i],split[j]);faces.append((i,j,j+n,i+n));uv.append([(0,0),(d,0),(d,roofz(split[j])),(0,roofz(split[i]))])
    obj=mesh(b['id']+'_footprint_wall',verts,faces,r.choice(plasters),uv=uv)
    obj['source_building_id']=b['id'];obj['source_district_id']=b['districtId'];obj['base_footprint_json']=json.dumps(p)
    obj['floors']=floors;obj['eave_height_m']=eave;obj['roof_type']='clipped_gable'
    # Roof uses the exact planar outline. A shallow rim gives an eave without moving walls.
    roofmat=M['roof_ochre'] if r.random()<.43 else M['roof_slate']
    for side in (False,True):
        q=clip(p,v,mid,side)
        if len(q)<3:continue
        rv=[(x,y,roofz((x,y))+.10) for x,y in q]
        ru=[(x*u.x+y*u.y,(x*v.x+y*v.y-mid)*math.sqrt(1+(rise/max(.1,half))**2)) for x,y in q]
        mesh(b['id']+'_roof_'+str(side),rv,[tuple(range(len(q)))],roofmat,uv=[ru])
    oak=Batch(b['id']+'_modular_oak',M['timber']);ink=Batch(b['id']+'_roof_rims',M['ink']);glass=Batch(b['id']+'_window_recesses',M['glass'])
    frames=Batch(b['id']+'_window_leads',M['canvas_cream'])
    for a,c in zip(split,split[1:]+split[:1]):ink.beam((*a,roofz(a)+.12),(*c,roofz(c)+.12),.10)
    ridge=[q for q in split if abs(q[0]*v.x+q[1]*v.y-mid)<1e-5]
    if len(ridge)>=2:ink.beam((*ridge[0],eave+rise+.14),(*ridge[-1],eave+rise+.14),.16)
    for side_i,(a,c) in enumerate(zip(p,p[1:]+p[:1])):
        length=math.dist(a,c);t=Vector(((c[0]-a[0])/length,(c[1]-a[1])/length,0));out=Vector((t.y,-t.x,0));aa=Vector((*a,0))+out*.055
        def pos(s,z):return aa+t*s+Vector((0,0,z))
        for level in range(floors+1):oak.beam(pos(0,.35+level*(eave-.35)/floors),pos(length,.35+level*(eave-.35)/floors),.20,.18)
        bays=max(1,round(length/3.4));bay=length/bays
        for j in range(bays+1):
            xy=pos(j*bay,0);top=roofz((xy.x,xy.y))
            oak.beam(pos(j*bay,.3),pos(j*bay,top),.19,.18)
        for j in range(bays):
            # Diagonal braces and dark inset casement windows.
            s=(j+.5)*bay
            for floor in range(floors):
                zbase=.35+floor*(eave-.35)/floors
                if (floor>0 and j%2==0) or (floor==0 and j%4==0):oak.beam(pos(j*bay+.22,zbase+.20),pos((j+1)*bay-.22,zbase+2.75),.075,.09)
                if bay<1.4:continue
                if floor==0 and j==bays//2 and side_i==0:
                    glass.box(pos(s,1.20)+out*.05,(t,out,Vector((0,0,1))),(1.25,.10,2.35))
                    for dx in (-.69,.69):oak.beam(pos(s+dx,.05)+out*.10,pos(s+dx,2.48)+out*.10,.16)
                    oak.beam(pos(s-.7,2.48)+out*.10,pos(s+.7,2.48)+out*.10,.16)
                else:
                    z=zbase+1.75;w=min(.95,bay*.38);h=1.25
                    glass.box(pos(s,z)+out*.10,(t,out,Vector((0,0,1))),(w,.11,h))
                    for dx in (-w/2,w/2):oak.beam(pos(s+dx,z-h/2)+out*.19,pos(s+dx,z+h/2)+out*.19,.095)
                    for zz in (-h/2,h/2):oak.beam(pos(s-w/2,z+zz)+out*.19,pos(s+w/2,z+zz)+out*.19,.095)
                    frames.beam(pos(s,z-h/2)+out*.20,pos(s,z+h/2)+out*.20,.04)
                    frames.beam(pos(s-w/2,z)+out*.20,pos(s+w/2,z)+out*.20,.04)
    oak.finish();ink.finish();glass.finish();frames.finish()
    # Chimneys are a separate repeated kit element, rooted inside the footprint.
    cc=center(p);cp=(cc[0]+u.x*(max(us)-min(us))*.18,cc[1]+u.y*(max(us)-min(us))*.18)
    ch=Batch(b['id']+'_chimney',M['stone_plain']);z=roofz(cp)
    ch.box((cp[0],cp[1],z+.9),((u.x,u.y,0),(v.x,v.y,0),(0,0,1)),(.85,1.15,2.1))
    ch.box((cp[0],cp[1],z+2.0),((u.x,u.y,0),(v.x,v.y,0),(0,0,1)),(1.1,1.4,.23));ch.finish()
    # A reusable small gabled dormer; it sits on the original roof plane.
    if half>2.7 and max(us)-min(us)>5.5 and r.random()<.65:
        sg=1 if v.x*(-1)+v.y*(-1)>0 else -1
        normal=Vector((v.x*sg,v.y*sg,0));along=Vector((u.x,u.y,0))
        dc=Vector((cc[0],cc[1],0))+normal*(half*.53)
        corner=[dc-along*.75-normal*.7,dc+along*.75-normal*.7,dc+along*.75+normal*.7,dc-along*.75+normal*.7]
        if all(inside((a.x,a.y),p) for a in corner):
            base=min(roofz((a.x,a.y)) for a in corner)-.08;de=base+1.45;dr=de+.72
            dv=[(a.x,a.y,base) for a in corner]+[(a.x,a.y,de) for a in corner]
            dv.extend([tuple(dc-normal*.7+Vector((0,0,dr))),tuple(dc+normal*.7+Vector((0,0,dr)))])
            mesh(b['id']+'_dormer_gable',dv,[(0,1,5,8,4),(1,2,6,5),(2,3,7,9,6),(3,0,4,7)],M['plaster'])
            mesh(b['id']+'_dormer_roof',dv,[(4,8,9,7),(8,5,6,9)],roofmat,uv=[[(0,0),(1,0),(1,1.4),(0,1.4)],[(0,0),(1,0),(1,1.4),(0,1.4)]])
            db=Batch(b['id']+'_dormer_frame',M['timber']);dg=Batch(b['id']+'_dormer_glass',M['glass'])
            face=dc+normal*.73+Vector((0,0,base+.83));dg.box(face,(along,normal,Vector((0,0,1))),(.66,.10,.87))
            for side in (-1,1):db.beam(face+along*.40*side+Vector((0,0,-.48)),face+along*.40*side+Vector((0,0,.48)),.10)
            db.beam(face-along*.43+Vector((0,0,.48)),face+along*.43+Vector((0,0,.48)),.10)
            db.finish();dg.finish()
    build_records.append({'id':b['id'],'footprint':p,'floors':floors,'eave':eave,'ridgeHeight':eave+rise,'roof':'clipped_gable'})
print('Built buildings:',len(build_records),flush=True)

# The crop is an explicit extraction of the plan, never a rearrangement.
crop=points(data['cropPolygon']);extrude('Study_ground',crop,-.8,0,M['ground'],'00_GROUND')
for district in data['districts']:
    if district['wardType']=='Market':extrude('Original_market_square',points(district['points']),.005,.025,M['road'],'00_GROUND')
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

def wall_span(a,b,name,height=12.0):
    d=math.dist(a,b)
    if d<.1:return
    u=Vector(((b[0]-a[0])/d,(b[1]-a[1])/d,0));v=Vector((-u.y,u.x,0));th=2.5
    p=[(a[0]+v.x*th/2,a[1]+v.y*th/2),(a[0]-v.x*th/2,a[1]-v.y*th/2),(b[0]-v.x*th/2,b[1]-v.y*th/2),(b[0]+v.x*th/2,b[1]+v.y*th/2)]
    extrude(name,p,.0,height,M['stone'],'02_CITY_WALL')
    batt=Batch(name+'_merlons',M['stone_plain'],'02_CITY_WALL')
    count=max(1,int(d/3.5))
    for j in range(count):
        t=(j+.5)/count;z=height+.85
        batt.box((a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,z),(u,v,Vector((0,0,1))),(1.65,th+.25,1.7))
    batt.finish()
    rim=Batch(name+'_coping',M['stone_plain'],'02_CITY_WALL')
    rim.box(((a[0]+b[0])/2,(a[1]+b[1])/2,height-.20),(u,v,Vector((0,0,1))),(d,th+.40,.40));rim.finish()

wall_stats=[]
for wall in data['walls']:
    p=points(wall['points']);gates=points(wall.get('gatePoints',[]));active=wall.get('activeSegments',[True]*len(p))
    segment_pairs=list(zip(p,p[1:]+p[:1])) if wall.get('closed',True) else list(zip(p,p[1:]))
    for i,(a,b) in enumerate(segment_pairs):
        if i>=len(active) or not active[i]:continue
        d=math.dist(a,b)
        if d<.01:continue
        # Gate voids are already encoded as inactive spans. Never widen them.
        intervals=[(0.,1.)]
        for j,(lo,hi) in enumerate(intervals):
            aa=(a[0]+(b[0]-a[0])*lo,a[1]+(b[1]-a[1])*lo);bb=(a[0]+(b[0]-a[0])*hi,a[1]+(b[1]-a[1])*hi)
            wall_span(aa,bb,wall['id']+'_segment_%d_%d'%(i,j));wall_stats.append([aa,bb])
    for i,q in enumerate(points(wall.get('towerPoints',[]))):
        radius=4.3;sides=12;poly=[(q[0]+radius*math.cos(t*2*math.pi/sides),q[1]+radius*math.sin(t*2*math.pi/sides)) for t in range(sides)]
        extrude(wall['id']+'_tower_'+str(i),poly,0,16.7,M['stone'],'02_CITY_WALL')
        ring=Batch(wall['id']+'_tower_crenels_'+str(i),M['stone_plain'],'02_CITY_WALL')
        for t in range(12):
            ang=t*math.tau/12;u=Vector((-math.sin(ang),math.cos(ang),0));v=Vector((math.cos(ang),math.sin(ang),0))
            ring.box((q[0]+3.95*v.x,q[1]+3.95*v.y,17.35),(u,v,Vector((0,0,1))),(1.35,1.15,1.65))
        ring.finish()
        # Dark arrow loops on outward-facing tower facets.
        slots=Batch(wall['id']+'_arrowloops_'+str(i),M['glass'],'02_CITY_WALL')
        for ang in [math.pi/6+j*math.tau/6 for j in range(6)]:
            u=Vector((-math.sin(ang),math.cos(ang),0));v=Vector((math.cos(ang),math.sin(ang),0))
            for zz in (6.0,11.3):slots.box((q[0]+4.18*v.x,q[1]+4.18*v.y,zz),(u,v,Vector((0,0,1))),(.30,.10,1.6))
        slots.finish()
    for i,g in enumerate(gates):
        # Find the original contiguous inactive chain containing this gate.
        idx=min(range(len(p)),key=lambda j:math.dist(g,p[j]));lo=idx;hi=idx
        while lo>0 and not active[lo-1]:lo-=1
        while hi<len(active) and not active[hi]:hi+=1
        if hi<=lo:continue
        near=(p[lo],p[hi]);dd=math.dist(*near);u=Vector(((near[1][0]-near[0][0])/dd,(near[1][1]-near[0][1])/dd,0));v=Vector((-u.y,u.x,0));gc=((near[0][0]+near[1][0])/2,(near[0][1]+near[1][1])/2)
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
if not opts.no_props:
    from props import build_market
    props=build_market(points(data['plaza']['points']),[points(b['points']) for b in data['buildings']],data['roads'],M,seed=7,features=data.get('features',[]))
    print('Market life:',props,flush=True)

# A restrained sun and a paper-white world, with a transparent background for layout.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24 if opts.preview else 48
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
world=bpy.data.worlds.new('Paper daylight');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.88,.88,.84,1);world.node_tree.nodes['Background'].inputs[1].default_value=.8;scene.world=world
wn=world.node_tree.nodes;wl=world.node_tree.links
paper=wn.new('ShaderNodeBackground');paper.inputs[0].default_value=(.965,.953,.922,1);paper.inputs[1].default_value=1
lightpath=wn.new('ShaderNodeLightPath');wmix=wn.new('ShaderNodeMixShader')
wl.new(lightpath.outputs['Is Camera Ray'],wmix.inputs[0]);wl.new(wn['Background'].outputs[0],wmix.inputs[1]);wl.new(paper.outputs[0],wmix.inputs[2]);wl.new(wmix.outputs[0],wn['World Output'].inputs[0])
light=bpy.data.lights.new('Soft morning sun','SUN');light.energy=2.0;light.angle=math.radians(20)
sun=bpy.data.objects.new('Soft morning sun',light);scene.collection.objects.link(sun);sun.rotation_euler=(math.radians(25),math.radians(-30),math.radians(-25))
scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
scene.render.resolution_x=1400 if opts.preview else 2800;scene.render.resolution_y=1400 if opts.preview else 2800;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.film_transparent=False
camdata=bpy.data.cameras.new('Axonometric camera');cam=bpy.data.objects.new('Axonometric camera',camdata);scene.collection.objects.link(cam);scene.camera=cam
camdata.type='ORTHO';c=Vector((*center(crop),5));az=math.radians(opts.angle);el=math.radians(opts.elevation)
direction=Vector((math.cos(az)*math.cos(el),math.sin(az)*math.cos(el),math.sin(el)))
cam.location=c+direction*550;cam.rotation_euler=(c-cam.location).to_track_quat('-Z','Y').to_euler();camdata.clip_end=2000
bpy.context.view_layer.update()
allpts=[]
for ob in scene.objects:
    if ob.type=='MESH':allpts.extend([ob.matrix_world@v.co for v in ob.data.vertices])
inv=cam.matrix_world.inverted();proj=[inv@p for p in allpts];minx=min(p.x for p in proj);maxx=max(p.x for p in proj);miny=min(p.y for p in proj);maxy=max(p.y for p in proj)
shift=cam.matrix_world.to_3x3()@Vector(((minx+maxx)/2,(miny+maxy)/2,0));cam.location+=shift
camdata.ortho_scale=max(maxx-minx,maxy-miny)*1.08
scene.render.use_freestyle=True
fs=scene.view_layers[0].freestyle_settings
lines=fs.linesets[0] if fs.linesets else fs.linesets.new('Architectural contour')
lines.select_silhouette=True;lines.select_border=True;lines.select_crease=False
lines.select_edge_mark=False;lines.select_material_boundary=False
fs.crease_angle=math.radians(105)
style=lines.linestyle;style.color=(.065,.058,.048);style.thickness=.75 if opts.preview else 1.3;style.alpha=.94
noise=style.geometry_modifiers.new('Subtle nib variation','SPATIAL_NOISE');noise.amplitude=.16 if opts.preview else .28;noise.scale=9;noise.octaves=1
seams=fs.linesets.new('Fine structural seams');seams.select_silhouette=False;seams.select_border=False;seams.select_crease=True
seams.select_edge_mark=False;seams.select_material_boundary=False
seams.linestyle.color=(.20,.175,.14);seams.linestyle.thickness=.40 if opts.preview else .70;seams.linestyle.alpha=.8
for line_set in (lines,seams):
    # Road ribbons overlap at junctions; their mesh borders are construction seams,
    # not inked architectural features. Preserve them in geometry, omit their ink.
    line_set.select_by_collection=True;line_set.collection=collection('00_GROUND');line_set.collection_negation='EXCLUSIVE'
scene.render.line_thickness=1.0
scene.render.filepath=str(OUT/('render-preview.png' if opts.preview else 'market-quarter-render.png'))
scene['source_selection']='selection.json';scene['structure_policy']='Exact building wall footprints and original plan roads; vertical architecture is designed.'
scene['building_count']=len(build_records);scene['sample_seed']=data.get('seed',7)
(OUT/'scene-manifest.json').write_text(json.dumps({'buildings':build_records,'wallSpans':wall_stats,'props':props,'camera':{'azimuth':opts.angle,'elevation':opts.elevation},'source':data.get('source'),'horizontalScale':opts.plan_scale,'notes':'All plan XY coordinates and road widths receive the same reversible uniform scale. Building wall footprints are exact under inverse mapping; floors, facades, roofs and props are designed interpretations.'},ensure_ascii=False,indent=2),encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'market-quarter.blend'))
print('Rendering',scene.render.filepath,scene.cycles.device,flush=True)
bpy.ops.render.render(write_still=True)
print('FINISHED',flush=True)
