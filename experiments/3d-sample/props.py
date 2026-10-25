"""Modular medieval market props for the planning-driven Blender sample.

All coordinates stay in the input planning coordinate system (XY, meters).
build_market is safe to call after the terrain and buildings have been created.
"""
import math
import random
import bpy
from mathutils import Vector


COLLECTION = '03_MARKET_LIFE'


def xy(point):
    return (float(point['x']), float(point['y'])) if isinstance(point, dict) else (float(point[0]), float(point[1]))


def inside(point, polygon):
    x, y = point
    result = False
    j = len(polygon) - 1
    for i in range(len(polygon)):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if ((yi > y) != (yj > y)) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            result = not result
        j = i
    return result


def segment_distance(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    d = dx * dx + dy * dy
    t = max(0., min(1., ((p[0]-a[0])*dx + (p[1]-a[1])*dy)/d)) if d else 0.
    return math.hypot(p[0]-a[0]-t*dx, p[1]-a[1]-t*dy)


def boundary_distance(point, polygon):
    return min(segment_distance(point, polygon[i-1], polygon[i]) for i in range(len(polygon)))


class Mesh:
    """One indexed mesh per asset: beams and cargo do not create tiny objects."""
    def __init__(self, materials):
        self.vertices, self.faces, self.slots = [], [], []
        self.materials = materials

    def poly(self, vertices, faces, material):
        offset = len(self.vertices)
        self.vertices.extend(vertices)
        self.faces.extend(tuple(offset+i for i in face) for face in faces)
        self.slots.extend([material] * len(faces))

    def box(self, center, size, material):
        x, y, z = center
        a, b, c = (v/2 for v in size)
        self.poly([(x-a,y-b,z-c),(x+a,y-b,z-c),(x+a,y+b,z-c),(x-a,y+b,z-c),
                   (x-a,y-b,z+c),(x+a,y-b,z+c),(x+a,y+b,z+c),(x-a,y+b,z+c)],
                  [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)], material)

    def rings(self, center, rings, material, sides=12, caps=True):
        x, y, z = center
        vertices = [(x+rx*math.cos(i*math.tau/sides), y+ry*math.sin(i*math.tau/sides), z+h)
                    for h, rx, ry in rings for i in range(sides)]
        faces = []
        for r in range(len(rings)-1):
            for i in range(sides):
                j=(i+1)%sides
                faces.append((r*sides+i,r*sides+j,(r+1)*sides+j,(r+1)*sides+i))
        if caps:
            faces.extend([tuple(reversed(range(sides))),tuple((len(rings)-1)*sides+i for i in range(sides))])
        self.poly(vertices, faces, material)

    def cylinder(self, center, radius, height, material, sides=12):
        self.rings(center, [(0,radius,radius),(height,radius,radius)], material, sides)

    def beam(self, a, b, radius, material, sides=6):
        a, b = Vector(a), Vector(b)
        axis=(b-a).normalized()
        ref=Vector((0,0,1)) if abs(axis.z)<.9 else Vector((0,1,0))
        u=axis.cross(ref).normalized()*radius
        v=axis.cross(u).normalized()*radius
        vertices=[tuple(center + u*math.cos(i*math.tau/sides)+v*math.sin(i*math.tau/sides)) for center in (a,b) for i in range(sides)]
        faces=[(i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides)]
        faces.extend([tuple(reversed(range(sides))),tuple(sides+i for i in range(sides))])
        self.poly(vertices, faces, material)

    def create_mesh(self, name):
        data=bpy.data.meshes.new(name)
        data.from_pydata(self.vertices, [], self.faces)
        data.update()
        names=list(self.materials)
        for key in names:
            data.materials.append(self.materials[key])
        lookup={key:i for i,key in enumerate(names)}
        for face, slot in zip(data.polygons, self.slots):
            face.material_index=lookup[slot]
        return data


def material(name, color):
    mat=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color=(*color,1)
    mat.use_nodes=True
    bsdf=mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value=(*color,1)
    bsdf.inputs['Roughness'].default_value=.92
    return mat


def make_object(name, data, position, angle, collection, kind):
    obj=bpy.data.objects.new(name,data)
    collection.objects.link(obj)
    obj.location=(*position,.045)
    obj.rotation_euler[2]=angle
    obj['asset_kind']=kind
    return obj


def crate(mesh, center, size=(.6,.48,.52), open_top=False):
    x,y,z=center
    w,d,h=size
    # Slight gaps between planks generate clean, purposeful contour detail.
    for k in range(3):
        zz=z+(k+.5)*h/3
        for side in (-1,1):
            mesh.box((x,y+side*(d/2-.025),zz),(w,.05,h/3-.018),'wood_light')
            mesh.box((x+side*(w/2-.025),y,zz),(.05,d,h/3-.018),'wood_light')
    if not open_top:
        for k in range(4):
            mesh.box((x-w/2+(k+.5)*w/4,y,z+h),(w/4-.012,d,.035),'wood_light')
    for side in (-1,1):
        for xx in (-1,1):
            mesh.box((x+xx*(w/2-.06),y+side*d/2,z+h/2),(.065,.025,h),'timber')


def barrel(mesh, center, scale=1.):
    x,y,z=center
    mesh.rings((x,y,z),[(0,.29*scale,.29*scale),(.15*scale,.34*scale,.34*scale),(.6*scale,.35*scale,.35*scale),(.82*scale,.29*scale,.29*scale)],'wood_light',12)
    for height, r in ((.13,.337),(.64,.34)):
        mesh.rings((x,y,z+height*scale),[(0,r*scale,r*scale),(.05*scale,r*scale,r*scale)],'metal',12,False)
    for k in range(4):
        xx=(k-1.5)*.12*scale
        length=2*math.sqrt(max(.01,(.28*scale)**2-xx*xx))
        mesh.box((x+xx,y,z+.826*scale),(.108*scale,length,.018*scale),'wood_light')


def stall_mesh(materials, width, variant, rng, include_goods=True):
    m=Mesh(materials)
    # Front is -Y, back is +Y. Cotton awning is a shallow lean-to.
    for x in (-width/2+.13,width/2-.13):
        for y,h in ((-.98,2.38),(.98,2.77)):
            m.box((x,y,h/2),(.10,.10,h),'timber')
        m.beam((x,-1.10,2.39),(x,1.12,2.80),.045,'timber')
        m.beam((x,.96,1.95),(x,.30,2.63),.035,'timber')
    m.beam((-width/2,-.98,2.39),(width/2,-.98,2.39),.052,'timber')
    m.beam((-width/2,.98,2.78),(width/2,.98,2.78),.052,'timber')
    strips=8
    profile=[(-1.18,2.33),(-.86,2.39),(0,2.52),(.7,2.70),(1.18,2.77)]
    for i in range(strips):
        x0=-width/2+i*width/strips
        x1=x0+width/strips
        verts=[(x,y,z) for x in (x0,x1) for y,z in profile]
        faces=[(j,j+1,len(profile)+j+1,len(profile)+j) for j in range(len(profile)-1)]
        canvas='canvas_cream' if (i+variant)%3 else 'canvas'
        m.poly(verts,faces,canvas)
        m.poly([(x0,-1.18,2.33),(x1,-1.18,2.33),(x1,-1.18,2.18),(x0,-1.18,2.18)],[(0,1,2,3)],canvas)
    # Slatted sales counter, table legs and visible diagonal brace.
    for i in range(5):
        m.box((0,-.47+(i-2)*.115,1.02),(width-.28,.105,.06),'wood_light')
    for x in (-width/2+.30,width/2-.30):
        for y in (-.70,-.23):
            m.box((x,y,.49),(.075,.075,.98),'timber')
    m.beam((-width/2+.3,-.7,.2),(width/2-.3,-.7,.87),.035,'timber')
    # Low fabric counter panel leaves the structural legs visible.
    m.box((0,-.76,.69),(width-.70,.022,.53),'canvas_cream')
    for x in ((-width*.27,0,width*.27) if include_goods else ()):
        crate(m,(x,-.46,1.065),(.56,.39,.12),True)
        for k in range(6):
            px=x+(k%3-1)*.14
            py=-.46+(k//3-.5)*.13
            color='produce_ochre' if variant%2 else 'produce_sage'
            m.rings((px,py,1.20),[(0,.056,.056),(.05,.078,.066),(.10,.026,.032)],color,7)
    crate(m,(-width*.29,.48,0),(.68,.51,.56))
    if variant%2:
        crate(m,(-width*.29,.48,.59),(.52,.45,.44))
    barrel(m,(width*.29,.44,0),.82)
    return m.create_mesh('Market stall %02d'%variant)


def well_mesh(materials):
    m=Mesh(materials)
    # Open centre: an annulus made of discrete radial stone blocks.
    sides=12
    for row in range(3):
        for i in range(sides):
            a=(i+(row%2)*.5)*math.tau/sides+.015
            b=(i+1+(row%2)*.5)*math.tau/sides-.015
            verts=[(r*math.cos(t),r*math.sin(t),z) for z in (row*.25,(row+1)*.25-.013) for r,t in ((.73,a),(1.08,a),(1.08,b),(.73,b))]
            m.poly(verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'stone')
    m.cylinder((0,0,.16),.71,.015,'water_dark',16)
    for x in (-.93,.93):
        m.box((x,0,1.52),(.15,.15,2.48),'timber')
    m.beam((-.93,0,2.20),(.93,0,2.20),.065,'timber',8)
    m.beam((0,0,.33),(0,0,2.2),.013,'wood_light',5)
    m.rings((0,0,2.17),[(0,.12,.12),(.10,.12,.12)],'timber',8)
    m.poly([(-1.3,-.8,2.65),(1.3,-.8,2.65),(1.3,0,3.10),(-1.3,0,3.10),(-1.3,.8,2.65),(1.3,.8,2.65)],[(0,1,2,3),(3,2,5,4)],'roof_slate')
    for x in (-1.3,1.3):
        m.beam((x,-.8,2.65),(x,0,3.1),.04,'timber')
        m.beam((x,0,3.1),(x,.8,2.65),.04,'timber')
    return m.create_mesh('Stone well with wooden winch')


def cart_mesh(materials):
    m=Mesh(materials)
    crate(m,(0,0,.55),(1.15,1.65,.48),True)
    m.beam((-.85,0,.46),(.85,0,.46),.065,'timber')
    for x in (-.72,.72):
        # Wheel axis is X; rings assembled explicitly to retain an open centre.
        for i in range(12):
            a=i*math.tau/12
            b=(i+1)*math.tau/12
            m.beam((x,.43*math.cos(a),.46+.43*math.sin(a)),(x,.43*math.cos(b),.46+.43*math.sin(b)),.038,'timber',5)
        for i in range(8):
            a=i*math.tau/8
            m.beam((x,0,.46),(x,.4*math.cos(a),.46+.4*math.sin(a)),.021,'wood_light',4)
        m.beam((x-.06,0,.46),(x+.06,0,.46),.095,'timber',8)
    for x in (-.4,.4):
        m.beam((x,-.6,.64),(x,-2.15,.83),.035,'timber',6)
    barrel(m,(0,.28,.60),.6)
    crate(m,(0,-.40,.62),(.62,.50,.44))
    return m.create_mesh('Two wheeled hand cart')


def person_mesh(materials, index):
    m=Mesh(materials)
    robe='robe_%d'%(index%6)
    # Slim ankles and offset feet stay visible below a tapered tunic / dress.
    for side in (-1,1):
        x=side*.095
        y=side*(.045 if index%2 else .01)
        m.beam((x,y,.08),(x,y,.58),.045,'timber',6)
        m.box((x,y-.035,.045),(.11,.22,.09),'timber')
    m.rings((0,0,0),[(.30,.215,.15),(.73,.16,.115),(.99,.155,.115),(1.27,.225,.13),(1.34,.15,.10)],robe,8)
    m.rings((0,0,.99),[(0,.165,.125),(.045,.165,.125)],'timber',8)
    m.cylinder((0,0,1.30),.061,.12,'skin',8)
    m.rings((0,0,1.40),[(0,.065,.065),(.045,.102,.095),(.17,.10,.09),(.225,.055,.05)],'skin',8)
    # A quiet cap / coif makes people read as clothed figures, not bead shapes.
    cap='canvas_cream' if index%3==0 else robe
    m.rings((0,.012,1.53),[(0,.108,.10),(.08,.11,.095),(.15,.055,.055)],cap,8)
    for side in (-1,1):
        shoulder=(side*.205,0,1.23)
        elbow=(side*.28,-.025,1.02)
        hand=(side*.24,-.12,.86)
        if index%3==0 and side==1:
            hand=(.23,-.26,1.07)
        m.beam(shoulder,elbow,.071,robe,6)
        m.beam(elbow,hand,.055,robe,6)
        m.rings(hand,[(0,.045,.04),(.085,.042,.037)],'skin',6)
    if index%4==0:
        m.rings((.20,-.24,.73),[(0,.11,.095),(.20,.14,.12)],'wood_light',8)
    return m.create_mesh('Market visitor variant %02d'%index)


def statue_mesh(materials, footprint):
    """The lowest stone step uses the exact supplied planning footprint."""
    m=Mesh(materials)
    center=(sum(x for x,y in footprint)/len(footprint),sum(y for x,y in footprint)/len(footprint))
    local=[(x-center[0],y-center[1]) for x,y in footprint]
    count=len(local)
    for scale,z0,z1 in ((1.,0,.22),(.86,.22,.43),(.61,.43,1.37),(.68,1.37,1.55)):
        vertices=[(x*scale,y*scale,z) for z in (z0,z1) for x,y in local]
        faces=[tuple(reversed(range(count))),tuple(count+i for i in range(count))]
        faces.extend((i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count))
        m.poly(vertices,faces,'stone')
    # A tall, faceted robed guardian, with readable shoulder / arm silhouette.
    m.rings((0,0,1.55),[(0,.53,.36),(.85,.42,.30),(1.46,.32,.25),(2.12,.51,.30),(2.25,.28,.22)],'statue_stone',10)
    m.cylinder((0,0,3.73),.12,.20,'statue_stone',8)
    m.rings((0,-.025,3.89),[(0,.16,.15),(.10,.22,.19),(.38,.20,.18),(.49,.11,.10)],'statue_stone',8)
    # Cloak behind the shoulders, book in one hand and long staff in the other.
    m.poly([(-.48,.17,3.63),(.48,.17,3.63),(.62,.24,1.66),(-.62,.24,1.66)],[(0,1,2,3)],'stone')
    m.beam((-.46,0,3.60),(-.66,-.24,3.14),.16,'statue_stone',8)
    m.beam((-.66,-.24,3.14),(-.27,-.43,3.18),.14,'statue_stone',8)
    m.box((-.18,-.46,3.26),(.48,.13,.58),'stone')
    m.beam((.46,0,3.60),(.67,-.12,3.16),.15,'statue_stone',8)
    m.beam((.67,-.12,3.16),(.72,-.24,3.30),.12,'statue_stone',8)
    m.beam((.73,-.25,1.70),(.73,-.25,4.25),.038,'statue_stone',6)
    # Subtle vertical folds supply a few lines without a dense noisy mesh.
    for x in (-.31,-.13,.12,.30):
        m.beam((x*.85,-.255,2.90),(x*1.22,-.315,1.67),.018,'stone',4)
    return m.create_mesh('Planning statue and exact footprint plinth'),center


def build_market(plaza_points, building_polygons, roads, materials, seed=42, features=None, authored_assets=False):
    """Place reusable market assets; return counts and constraint checks.

    Buildings accept polygon lists or dicts with ``points`` / ``polygon`` keys.
    Roads accept dictionaries containing ``points`` and ``width`` (meters).
    The plaza is never reshaped and no building footprint is modified.
    """
    rng=random.Random(seed)
    plaza=[xy(p) for p in plaza_points]
    if len(plaza)<3:
        return {'stalls':0,'people':0,'well':0,'cart':0,'error':'Plaza has fewer than three vertices'}
    polygons=[]
    for polygon in building_polygons:
        if isinstance(polygon,dict):
            polygon=polygon.get('points',polygon.get('polygon',polygon.get('vertices',[])))
        points=[xy(p) for p in polygon]
        if len(points)>2:
            polygons.append(points)
    road_segments=[]
    for road in roads:
        points=[xy(p) for p in (road.get('points',[]) if isinstance(road,dict) else road)]
        width=float(road.get('width',3)) if isinstance(road,dict) else 3.
        for a,b in zip(points,points[1:]):
            if math.dist(a,b)>.01:
                road_segments.append((a,b,width))

    collection=bpy.data.collections.get(COLLECTION)
    if collection is None:
        collection=bpy.data.collections.new(COLLECTION)
        bpy.context.scene.collection.children.link(collection)
    mats=dict(materials)
    extra={'wood_light':(.46,.32,.20),'skin':(.61,.48,.35),'produce_ochre':(.60,.43,.22),
           'produce_sage':(.36,.42,.28),'water_dark':(.19,.25,.25),
           'robe_0':(.45,.43,.37),'robe_1':(.31,.35,.35),'robe_2':(.52,.45,.35),
           'robe_3':(.40,.31,.27),'robe_4':(.60,.57,.46),'robe_5':(.34,.38,.30),
           'statue_stone':(.61,.60,.55)}
    for key,color in extra.items():
        mats[key]=material('Market '+key,color)
    center=(sum(x for x,y in plaza)/len(plaza),sum(y for x,y in plaza)/len(plaza))
    # Principal direction of the plaza is the retained pedestrian corridor.
    xx=sum((x-center[0])**2 for x,y in plaza)
    yy=sum((y-center[1])**2 for x,y in plaza)
    cross=sum((x-center[0])*(y-center[1]) for x,y in plaza)
    angle=.5*math.atan2(2*cross,xx-yy)
    u=(math.cos(angle),math.sin(angle)); v=(-u[1],u[0])
    def world(a,b):
        return (center[0]+u[0]*a+v[0]*b,center[1]+u[1]*a+v[1]*b)
    projected=[((x-center[0])*u[0]+(y-center[1])*u[1],(x-center[0])*v[0]+(y-center[1])*v[1]) for x,y in plaza]
    amin,amax=min(a for a,b in projected),max(a for a,b in projected)
    bmin,bmax=min(b for a,b in projected),max(b for a,b in projected)
    occupied=[]
    def clear_buildings(p, margin=.8):
        return all(not inside(p,poly) and boundary_distance(p,poly)>=margin for poly in polygons)
    def clear_assets(p, radius):
        return all(math.dist(p,at)>radius+r for at,r in occupied)
    def valid_plaza(p, margin):
        return inside(p,plaza) and boundary_distance(p,plaza)>margin and clear_buildings(p,margin)
    def valid_footprint(p, w, d, rotation, margin=.2):
        ca,sa=math.cos(rotation),math.sin(rotation)
        for lx,ly in ((-w/2,-d/2),(w/2,-d/2),(w/2,d/2),(-w/2,d/2),(0,0),(-w/2,0),(w/2,0),(0,-d/2),(0,d/2)):
            q=(p[0]+ca*lx-sa*ly,p[1]+sa*lx+ca*ly)
            if not valid_plaza(q,margin):
                return False
        # Do not obstruct the actual carriageway if one crosses the plaza.
        return all(segment_distance(p,a,b)>min(width*.33,1.5)+min(w,d)/2 for a,b,width in road_segments)

    stats={'stalls':0,'people':0,'well':0,'statues':0,'cart':0,'cargo_groups':0,'people_building_clearance_m':.8,'retained_center_corridor_m':3.2,'statue_planning_locations':[], 'fountain_reserved_locations':[]}
    # Fountains are constructed after market life. Reserve their complete
    # source footprints now, including a small walking clearance, so neither
    # stalls, cargo nor people are later covered by a planned basin.
    for feature in features or []:
        if str(feature.get('kind', '')).lower() != 'fountain':
            continue
        footprint = [xy(p) for p in feature.get('points', [])]
        if len(footprint) < 3:
            continue
        location = tuple(sum(p[i] for p in footprint)/len(footprint) for i in range(2))
        radius = max(math.dist(location, p) for p in footprint) + .35
        occupied.append((location, radius))
        stats['fountain_reserved_locations'].append({'feature_id': feature.get('id'),
                    'scene_position': list(location), 'reserved_radius_m': radius,
                    'input_feature_points': [list(p) for p in footprint]})
    for feature in features or []:
        if str(feature.get('kind','')).lower()!='statue':
            continue
        footprint=[xy(p) for p in feature.get('points',[])]
        if len(footprint)<3:
            continue
        statue_data,location=statue_mesh(mats,footprint)
        obj=make_object('Planning statue '+str(feature.get('id',stats['statues'])),statue_data,location,0,collection,'statue')
        obj['source_feature_id']=str(feature.get('id',''))
        obj['input_footprint_xy']=[n for p in footprint for n in p]
        occupied.append((location,max(math.dist(location,p) for p in footprint)+.15))
        record={'feature_id':feature.get('id'),'scene_position':list(location),'input_feature_points':[list(p) for p in footprint],'footprint_preserved':True}
        if feature.get('source_points'):
            source=[xy(p) for p in feature['source_points']]
            record['source_feature_points']=[list(p) for p in source]
            record['source_planning_position']=[sum(p[i] for p in source)/len(source) for i in range(2)]
        stats['statue_planning_locations'].append(record)
        stats['statues']+=1

    # Search whole coherent rows; never scatter isolated fallback stalls.
    # Rows face inward across a pedestrian aisle and remain on valid plaza land.
    stall_locations=[]
    def candidate_rows(sign,limit=5):
        rows=[]
        for offset in (5.6,7.8,10.,12.2,14.4,16.6,18.8):
            b=offset*sign
            if not bmin+1.7<b<bmax-1.7:
                continue
            rotation=angle if sign>0 else angle+math.pi
            for start_index in range(-7,4):
                candidates=[]
                for i in range(limit):
                    a=(start_index+i)*4.35
                    p=world(a,b)
                    if valid_footprint(p,3.9,2.6,rotation) and clear_assets(p,2.0):
                        candidates.append((p,rotation,a,b))
                    else:
                        break
                if candidates:
                    mean_a=sum(c[2] for c in candidates)/len(candidates)
                    # Five neighbours beats proximity. Prefer centered rows.
                    score=len(candidates)*100-abs(mean_a)*.8-abs(offset-7.8)*.9
                    rows.append((score,candidates))
        return sorted(rows,key=lambda item:item[0],reverse=True)
    for sign in (1,-1):
        rows=candidate_rows(sign)
        if not rows:
            continue
        for p,rotation,a,b in rows[0][1]:
            width=rng.uniform(3.15,3.55)
            make_object('Market stall %02d'%(stats['stalls']+1),stall_mesh(mats,width,stats['stalls'],rng,include_goods=not authored_assets),p,rotation,collection,'market_stall')
            occupied.append((p,1.97))
            stall_locations.append((p,rotation,width))
            stats['stalls']+=1
    stats['stall_layout']='two continuous rows facing inward'
    stats['stall_positions']=[list(p) for p,rotation,width in stall_locations]
    # An off-centre well leaves the full central passage unblocked.
    if not stats['statues'] and not stats['fountain_reserved_locations'] and (amax-amin)*(bmax-bmin)>190:
        for a,b in ((0,3.5),(0,-3.5),(amin+3.2,3.2),(amax-3.2,-3.2)):
            p=world(a,b)
            if valid_plaza(p,1.5) and clear_assets(p,1.6) and all(segment_distance(p,x,y)>max(1.8,w*.35) for x,y,w in road_segments):
                make_object('Market well',well_mesh(mats),p,angle,collection,'well')
                occupied.append((p,1.55)); stats['well']=1
                break
    cart_data=None
    for attempt in range(250):
        if stats['cart']:
            break
        p=world(rng.uniform(amin,amax),rng.uniform(bmin,bmax))
        rot=angle+rng.uniform(-.2,.2)
        b=(p[0]-center[0])*v[0]+(p[1]-center[1])*v[1]
        if abs(b)<2.8:
            continue
        if valid_footprint(p,1.8,4.3,rot) and clear_assets(p,2.1):
            cart_data=cart_mesh(mats)
            make_object('Market hand cart',cart_data,p,rot,collection,'hand_cart')
            occupied.append((p,2.1)); stats['cart']=1
    for attempt in range(300):
        if stats['cargo_groups']>=5:
            break
        a=rng.uniform(amin,amax); b=rng.uniform(bmin,bmax)
        if abs(b)<2.4:
            continue
        p=world(a,b)
        if valid_plaza(p,.8) and clear_assets(p,.85) and all(segment_distance(p,x,y)>max(1.2,w*.30) for x,y,w in road_segments):
            m=Mesh(mats)
            barrel(m,(-.25,0,0),.9)
            crate(m,(.42,.07,0),(.54,.47,.48))
            if stats['cargo_groups']%2:
                crate(m,(.42,.07,.5),(.48,.42,.4))
            make_object('Market cargo %02d'%stats['cargo_groups'],m.create_mesh('Cargo cluster'),p,rng.random()*math.tau,collection,'cargo')
            occupied.append((p,.8)); stats['cargo_groups']+=1
    figures=[person_mesh(mats,i) for i in range(8)]
    people=[]
    # Roads provide overflow, but keep all figures near this selected plaza.
    radius=max(amax-amin,bmax-bmin)*.62+14
    segments=[s for s in road_segments if segment_distance(center,s[0],s[1])<radius]
    def add_person(p,facing,spacing=.8):
        if not clear_buildings(p,.8) or not clear_assets(p,.34) or any(math.dist(p,q)<spacing for q in people):
            return False
        obj=make_object('Market visitor %03d'%(len(people)+1),figures[len(people)%len(figures)],p,facing,collection,'person')
        scale=rng.uniform(1.60,1.85)/1.68
        obj.scale=(scale,scale,scale)
        people.append(p)
        return True
    # Small purposeful customer groups face each counter. The rest remain airy.
    customer_counts=[]
    for p,rotation,width in stall_locations:
        count=0
        ca,sa=math.cos(rotation),math.sin(rotation)
        for lx,ly in ((-.80,-2.55),(.16,-2.72),(.95,-2.54),(-.35,-3.48)):
            q=(p[0]+ca*lx-sa*ly,p[1]+sa*lx+ca*ly)
            if valid_plaza(q,.4) and add_person(q,rotation+math.pi,.76):
                count+=1
            if count>=3:
                break
        customer_counts.append(count)
    stats['customers_per_stall']=customer_counts
    # Derive usable walking sides from actual road segments. Distribute samples
    # at 3m spacing and reject sides backed directly against building footprints.
    road_candidates=[]
    for a,b,width in segments:
        dx,dy=b[0]-a[0],b[1]-a[1]
        length=math.hypot(dx,dy)
        count=max(1,int(length/3.0))
        for i in range(count):
            t=(i+.5)/count
            for side in (-1,1):
                offset=side*max(.45,min(width*.32,2.2))
                q=(a[0]+t*dx-dy/length*offset,a[1]+t*dy+dx/length*offset)
                if math.dist(q,center)<=radius and clear_buildings(q,1.0):
                    road_candidates.append((q,math.atan2(dy,dx)+math.pi/2+(math.pi if side>0 else 0)))
    rng.shuffle(road_candidates)
    stats['valid_roadside_positions']=len(road_candidates)
    roadside_people=0
    for p,facing in road_candidates:
        if roadside_people>=22:
            break
        if add_person(p,facing,1.5):
            roadside_people+=1
    stats['roadside_people']=roadside_people
    target=84
    for attempt in range(12000):
        if len(people)>=target:
            break
        if road_candidates and attempt%4==0:
            p,facing=rng.choice(road_candidates)
        else:
            p=world(rng.uniform(amin,amax),rng.uniform(bmin,bmax))
            facing=rng.random()*math.tau
            if not inside(p,plaza) or boundary_distance(p,plaza)<.4:
                continue
        add_person(p,facing,1.65)
    stats['people']=len(people)
    stats['plaza_bounds_m']=[round(amax-amin,2),round(bmax-bmin,2)]
    stats['people_clearance_verified']=all(clear_buildings(p,.8) for p in people)
    stats['objects']=len(collection.objects)
    return stats
