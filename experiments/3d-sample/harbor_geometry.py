"""Deterministic, Blender-independent geometry for the coastal adapter."""
import math
from footprint_geometry import float32, float32_radius


def xy(raw):
    return [(p['x'], p['y']) if isinstance(p, dict) else tuple(p[:2]) for p in raw]


def rotate(p, angle):
    c, s = math.cos(angle), math.sin(angle)
    return (p[0]*c-p[1]*s, p[0]*s+p[1]*c)


def land_ring(coast, crop):
    """Complement of the supported single, monotone coast inside its crop."""
    angle = ('east', 'south', 'west', 'north').index(coast['side'])*math.pi/2
    local = [rotate(p, -angle) for p in xy(crop)]
    left = min(p[0] for p in local)
    line = sorted([rotate(p, -angle) for p in xy(coast['shoreline'])], key=lambda p:p[1])
    ring = line+[(left, line[-1][1]), (left, line[0][1])]
    ring = [rotate(p, angle) for p in ring]
    bounds = (min(p[0] for p in xy(crop)), max(p[0] for p in xy(crop)),
              min(p[1] for p in xy(crop)), max(p[1] for p in xy(crop)))
    for axis, value, sign in ((0,bounds[0],1),(0,bounds[1],-1),(1,bounds[2],1),(1,bounds[3],-1)):
        output = []
        for a,b in zip(ring,ring[1:]+ring[:1]):
            da,db = sign*(a[axis]-value),sign*(b[axis]-value)
            if da >= -1e-8:output.append(a)
            if (da >= -1e-8) != (db >= -1e-8):
                t=da/(da-db);output.append(tuple(a[i]+t*(b[i]-a[i]) for i in (0,1)))
        ring=output
    return ring


def inside(p, poly):
    hit=False
    for a,b in zip(poly,poly[1:]+poly[:1]):
        if (a[1]>p[1])!=(b[1]>p[1]) and p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]:hit=not hit
    return hit


def segment_distance(p,a,b):
    d=(b[0]-a[0],b[1]-a[1]);ll=sum(v*v for v in d)
    t=max(0,min(1,sum((p[i]-a[i])*d[i] for i in (0,1))/ll)) if ll else 0
    return math.dist(p,(a[0]+t*d[0],a[1]+t*d[1]))


def ring_samples(poly, step=.4):
    return [tuple(a[k]+(b[k]-a[k])*j/n for k in (0,1))
            for a,b in zip(poly,poly[1:]+poly[:1])
            for n in [max(1,math.ceil(math.dist(a,b)/step))] for j in range(n)]


def overlaps(a,b,margin=0):
    def cross(p,q,r):return (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])
    if any(inside(p,b) for p in a) or any(inside(p,a) for p in b):return True
    for p,q in zip(a,a[1:]+a[:1]):
        for r,s in zip(b,b[1:]+b[:1]):
            if cross(p,q,r)*cross(p,q,s)<0 and cross(r,s,p)*cross(r,s,q)<0:return True
    return min(segment_distance(p,r,s) for aa,bb in ((a,b),(b,a)) for p in aa for r,s in zip(bb,bb[1:]+bb[:1]))<=margin


def rectangle(a,b,width):
    length=math.dist(a,b);n=(-(b[1]-a[1])/length*width/2,(b[0]-a[0])/length*width/2)
    return [(a[0]+n[0],a[1]+n[1]),(a[0]-n[0],a[1]-n[1]),(b[0]-n[0],b[1]-n[1]),(b[0]+n[0],b[1]+n[1])]


def area(poly):
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(poly,poly[1:]+poly[:1])))*.5


def subtract_convex(poly, hole):
    """Partition a convex polygon around a convex hole without moving its rim."""
    def bounds(ring):return (min(p[0] for p in ring),max(p[0] for p in ring),min(p[1] for p in ring),max(p[1] for p in ring))
    pbox,hbox=bounds(poly),bounds(hole)
    if pbox[1]<=hbox[0] or hbox[1]<=pbox[0] or pbox[3]<=hbox[2] or hbox[3]<=pbox[2]:return [poly]
    sign=1 if sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(hole,hole[1:]+hole[:1]))>0 else -1
    remainder=poly;outside=[]
    for a,b in zip(hole,hole[1:]+hole[:1]):
        positive=[];negative=[]
        if not remainder:break
        for p,q in zip(remainder,remainder[1:]+remainder[:1]):
            dp=sign*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))
            dq=sign*((b[0]-a[0])*(q[1]-a[1])-(b[1]-a[1])*(q[0]-a[0]))
            (positive if dp>=0 else negative).append(p)
            if (dp>=0)!=(dq>=0):
                t=dp/(dp-dq);v=(p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1]))
                positive.append(v);negative.append(v)
        if len(negative)>=3 and area(negative)>1e-10:outside.append(negative)
        remainder=positive
    return outside


def hull_ring(profile, z=0):
    """Horizontal exterior section of the authored hull, in boat-local metres."""
    sections=profile['sections'];factor=None
    for (za,fa),(zb,fb) in zip(sections,sections[1:]):
        if za<=z<=zb:
            factor=fa+(fb-fa)*(z-za)/(zb-za);break
    if factor is None:return []
    side=[(x*profile['length'],w*profile['width']*.5*factor) for x,w in profile['stations']]
    return side+[(x,-y) for x,y in reversed(side)]


def compare_sea_boundary(source, actual, tolerance):
    """Verify a cut sea against the exact float32 form of its source outline."""
    represented=[tuple(float32(v) for v in p) for p in source]
    enough=len(actual)>=len(source)
    maximum=max((math.dist(p,q) for p,q in zip(actual[:len(source)],represented)),default=float('inf'))
    rounding=max((math.dist(p,q) for p,q in zip(source,represented)),default=0)
    outside=[]
    for p in actual:
        if inside(p,represented):continue
        distance=min(segment_distance(p,a,b) for a,b in zip(represented,represented[1:]+represented[:1]))
        # Cut-edge vertices are also stored as float32, and can round just
        # outside a source edge. Bound that specific conversion explicitly.
        if distance>tolerance+float32_radius(p):outside.append({'point':p,'distance':distance})
    return {'passed':enough and maximum<tolerance and not outside,
            'sourceVertices':len(source),'actualVertices':len(actual),
            'sourceFloat32RoundingMaxSceneUnits':rounding,'boundaryErrorToFloat32SourceSceneUnits':maximum,
            'outsideVertices':outside,'boundaryToleranceSceneUnits':tolerance}


def segment_in_rectangle(a,b,c,d,width):
    """Parameter interval of shore a-b inside a straight dock corridor."""
    length=math.dist(c,d);u=((d[0]-c[0])/length,(d[1]-c[1])/length);n=(-u[1],u[0])
    local=lambda p:((p[0]-c[0])*u[0]+(p[1]-c[1])*u[1],(p[0]-c[0])*n[0]+(p[1]-c[1])*n[1])
    p,q=local(a),local(b);lo,hi=0.,1.
    for axis,minimum,maximum in ((0,-1,length+1),(1,-width/2,width/2)):
        delta=q[axis]-p[axis]
        if abs(delta)<1e-12:
            if not minimum<=p[axis]<=maximum:return None
            continue
        bounds=sorted(((minimum-p[axis])/delta,(maximum-p[axis])/delta))
        lo=max(lo,bounds[0]);hi=min(hi,bounds[1])
        if hi<=lo+1e-9:return None
    return lo,hi
