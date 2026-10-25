"""Deterministic, shallow medieval shop kits attached to existing facades.

No building footprint is edited. All kit positions are derived from a source
facade and are checked against neighbours, the crop, and road centre corridors.
The module has no bpy dependency, so candidate selection can be checked in plain
Python. Blender geometry is supplied by the renderer through ``api``.
"""
import hashlib
import math
import random


COLLECTION = '04_SHOPFRONTS'


def _xy(p):
    return (float(p['x']), float(p['y'])) if isinstance(p, dict) else tuple(p[:2])


def _dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    d = dx * dx + dy * dy
    k = max(0., min(1., ((p[0]-a[0])*dx + (p[1]-a[1])*dy)/d)) if d else 0.
    return math.hypot(p[0]-a[0]-k*dx, p[1]-a[1]-k*dy)


def _inside(p, poly):
    hit = False
    for a, b in zip(poly, poly[1:] + poly[:1]):
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]:
            hit = not hit
    return hit


def _boundary(p, poly):
    return min(_dist(p, a, b) for a, b in zip(poly, poly[1:] + poly[:1]))


def _intersects(a, b, c, d):
    def cross(p, q, r):
        return (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])
    if max(a[0],b[0])+1e-8 < min(c[0],d[0]) or max(c[0],d[0])+1e-8 < min(a[0],b[0]):
        return False
    if max(a[1],b[1])+1e-8 < min(c[1],d[1]) or max(c[1],d[1])+1e-8 < min(a[1],b[1]):
        return False
    return cross(a,b,c)*cross(a,b,d)<=1e-12 and cross(c,d,a)*cross(c,d,b)<=1e-12


def _polys_conflict(p, q, clearance=.17):
    for axis in (0,1):
        if max(v[axis] for v in p)+clearance < min(v[axis] for v in q) or max(v[axis] for v in q)+clearance < min(v[axis] for v in p):
            return False
    if any(_inside(v,q) for v in p) or any(_inside(v,p) for v in q):
        return True
    for a,b in zip(p,p[1:]+p[:1]):
        for c,d in zip(q,q[1:]+q[:1]):
            if _intersects(a,b,c,d) or min(_dist(a,c,d),_dist(b,c,d),_dist(c,a,b),_dist(d,a,b)) < clearance:
                return True
    return False


def _segment_near_polygon(a, b, poly, clearance):
    if _inside(a,poly) or _inside(b,poly):
        return True
    return any(_intersects(a,b,c,d) or min(_dist(a,c,d),_dist(b,c,d),_dist(c,a,b),_dist(d,a,b)) < clearance
               for c,d in zip(poly,poly[1:]+poly[:1]))


def _facades(record):
    if record.get('facades'):
        return record['facades']
    p = [_xy(q) for q in record['footprint']]
    area = sum(a[0]*b[1] - b[0]*a[1] for a, b in zip(p, p[1:] + p[:1]))
    result = []
    for a, b in zip(p, p[1:] + p[:1]):
        length = math.dist(a, b)
        if length < .1:
            continue
        out = ((b[1]-a[1])/length, (a[0]-b[0])/length)
        if area < 0:
            out = (-out[0], -out[1])
        result.append({'a': a, 'b': b, 'out': out, 'length': length, 'streetFacing': False})
    return result


def _candidate_shops(data, records, occupied=()):
    """Pick one clear facade patch on each of at most fourteen buildings."""
    polys = {r['id']: [_xy(p) for p in r['footprint']] for r in records}
    roads = [(a, b, float(r['width'])) for r in data.get('roads', [])
             for p in [[_xy(q) for q in r['points']]] for a, b in zip(p, p[1:])]
    plazas = [[_xy(q) for q in d['points']] for d in data.get('districts', []) if d.get('wardType') == 'Market']
    crop = [_xy(q) for q in data.get('cropPolygon', [])]
    candidates = []
    for record in records:
        if record.get('wardType') == 'Cathedral':
            continue
        rid = record['id']
        for face in _facades(record):
            a, b = _xy(face['a']), _xy(face['b'])
            length = math.dist(a, b)
            if length < 4.4:
                continue
            t = ((b[0]-a[0])/length, (b[1]-a[1])/length)
            n = _xy(face['out'])
            for frac in (.42, .64, .23, .78, .5):
                for width, depth in ((5.1, 1.28), (4.1, 1.12), (3.25, .90)):
                    s = max(width/2+.35, min(length-width/2-.35, length*frac))
                    if length < width + .7:
                        continue
                    origin = (a[0]+t[0]*s, a[1]+t[1]*s)
                    def q(x, y):
                        return (origin[0]+t[0]*x+n[0]*y, origin[1]+t[1]*x+n[1]*y)
                    # This includes all signboards, awnings, shutters, and cargo.
                    rect = [q(-width/2, .06), q(width/2, .06), q(width/2, depth), q(-width/2, depth)]
                    samples = [q(-width/2+width*i/10, .10+(depth-.10)*j/4) for i in range(11) for j in range(5)]
                    if crop and any(not _inside(v, crop) for v in samples):
                        continue
                    if any(_polys_conflict(rect,poly,.17) for key,poly in polys.items() if key != rid):
                        continue
                    # Keep a continuous useful centre corridor even on narrow roads.
                    if any(_segment_near_polygon(ra,rb,rect,max(1.05,rw*.23)) for ra,rb,rw in roads):
                        continue
                    if any(_inside(p, rect) or _boundary(p, rect)<radius for p, radius in occupied):
                        continue
                    front = q(0, depth+.7)
                    road_d = min((_dist(front, ra, rb)-rw/2 for ra, rb, rw in roads), default=999.)
                    plaza_d = min((0. if _inside(front, p) else _boundary(front, p) for p in plazas), default=999.)
                    if road_d > 5.0 and plaza_d > 5.0:
                        continue
                    # Most prominent are public square edges and camera-facing shops.
                    score = 25-max(0., plaza_d)*1.8 - max(0., road_d)*.8 + width*.9
                    score += (-n[0]-n[1])*.7 + (1 if face.get('streetFacing') else 0)
                    score -= abs(frac-.44)*.5
                    candidates.append({'building': record, 'origin': origin, 't': t, 'n': n,
                                       'width': width, 'depth': depth, 'footprint': rect, 'score': score})
    chosen, ids = [], set()
    for candidate in sorted(candidates, key=lambda c: (-c['score'], c['building']['id'])):
        if candidate['building']['id'] in ids:
            continue
        # Reject overlapping kits on adjacent facades, including perpendicular ones.
        poly = candidate['footprint']
        if any(_polys_conflict(poly,old['footprint'],.2) for old in chosen):
            continue
        ids.add(candidate['building']['id'])
        chosen.append(candidate)
        if len(chosen) >= 14:
            break
    return chosen


class _Kit:
    def __init__(self, candidate, api, recipe):
        self.c, self.api, self.recipe = candidate, api, recipe
        self.batches = {}
        self.objects = []
        self.rid = candidate['building']['id']
        self.axes = ((*candidate['t'], 0), (*candidate['n'], 0), (0, 0, 1))

    def world(self, p):
        c, t, n = self.c['origin'], self.c['t'], self.c['n']
        return (c[0]+t[0]*p[0]+n[0]*p[1], c[1]+t[1]*p[0]+n[1]*p[1], p[2])

    def batch(self, kind, mat):
        key = (kind, mat)
        if key not in self.batches:
            self.batches[key] = self.api['Batch'](self.rid+'_shop_'+kind+'_'+mat, self.api['M'][mat], COLLECTION)
        return self.batches[key]

    def box(self, p, dims, mat='timber', kind='carpentry'):
        self.batch(kind, mat).box(self.world(p), self.axes, dims)

    def beam(self, a, b, width=.055, mat='timber', kind='carpentry'):
        self.batch(kind, mat).beam(self.world(a), self.world(b), width)

    def poly(self, vertices, faces, mat, kind):
        obj = self.api['mesh'](self.rid+'_shop_'+kind, [self.world(v) for v in vertices], faces, self.api['M'][mat], COLLECTION)
        self.tag(obj, kind)

    def tag(self, obj, kind):
        if obj is not None:
            obj['source_building_id'] = self.rid
            obj['asset_kind'] = 'shopfront_'+kind
            obj['shop_recipe'] = self.recipe
            self.objects.append(obj)

    def ring(self, p, radius, height, mat='canvas_cream', kind='wares', sides=10):
        verts = [(p[0]+radius*math.cos(i*math.tau/sides), p[1]+radius*math.sin(i*math.tau/sides), p[2]+z)
                 for z in (0, height) for i in range(sides)]
        faces = [(i, (i+1)%sides, (i+1)%sides+sides, i+sides) for i in range(sides)]
        faces += [tuple(range(sides-1, -1, -1)), tuple(range(sides, sides*2))]
        self.poly(verts, faces, mat, kind)

    def finish(self):
        for (kind, mat), batch in self.batches.items():
            self.tag(batch.finish(), kind)
        return len(self.objects)


def _crate(kit, x, y, z, size=.55):
    for j in range(3):
        for sign in (-1, 1):
            kit.box((x, y+sign*size*.38, z+(j+.5)*size/3), (size, .042, size/3-.016), 'canvas', 'cargo')
            kit.box((x+sign*size*.47, y, z+(j+.5)*size/3), (.042, size*.8, size/3-.016), 'canvas', 'cargo')
    for side in (-1, 1):
        kit.beam((x-size*.43, y+side*size*.41, z+.05), (x+size*.43, y+side*size*.41, z+size-.05), .036, 'timber', 'cargo')
    for j in range(4):
        kit.box((x+(j-1.5)*size/4, y, z+size), (size/4-.014, size*.8, .035), 'canvas', 'cargo')


def _barrel(kit, x, y, scale=1):
    rings = [(0, .24), (.13, .28), (.56, .29), (.76, .24)]
    verts = [(x+r*scale*math.cos(i*math.tau/12), y+r*scale*math.sin(i*math.tau/12), .04+z*scale) for z, r in rings for i in range(12)]
    faces = [(k*12+i, k*12+(i+1)%12, (k+1)*12+(i+1)%12, (k+1)*12+i) for k in range(3) for i in range(12)]
    faces.append(tuple(36+i for i in range(12)))
    kit.poly(verts, faces, 'canvas', 'barrel')
    for z, r in ((.14,.281),(.59,.284)):
        for i in range(12):
            a, b = i*math.tau/12, (i+1)*math.tau/12
            kit.beam((x+r*scale*math.cos(a),y+r*scale*math.sin(a),z*scale), (x+r*scale*math.cos(b),y+r*scale*math.sin(b),z*scale), .035, 'metal', 'barrel_hoops')
    for i in range(12):
        a = i*math.tau/12
        kit.beam((x+.25*scale*math.cos(a),y+.25*scale*math.sin(a),.06), (x+.25*scale*math.cos(a),y+.25*scale*math.sin(a),.75*scale), .012, 'timber', 'barrel_staves')


def _sign(kit, width, depth, symbol):
    sx = width*.30
    sy = min(.91, depth-.17)
    z = 3.52
    kit.beam((sx,.08,z+.73),(sx,sy+.06,z+.73),.065,'metal','sign_bracket')
    kit.beam((sx,.08,z+.23),(sx,sy-.02,z+.73),.04,'metal','sign_bracket')
    kit.beam((sx-.34,sy,z+.61),(sx+.34,sy,z+.61),.045,'metal','sign_bracket')
    kit.beam((sx,sy,z+.61),(sx,sy,z+.73),.045,'metal','sign_bracket')
    for dx in (-.28,.28):
        kit.beam((sx+dx,sy,z+.61),(sx+dx,sy,z+.40),.022,'metal','sign_chain')
    kit.box((sx,sy,z),(1.0,.07,.80),'timber','signboard')
    # Cream geometric pictograms read at image scale without pseudo-text.
    def line(a,b,w=.045):
        kit.beam((sx+a[0]*1.25,sy+.043,z+a[1]*1.25),(sx+b[0]*1.25,sy+.043,z+b[1]*1.25),w*1.15,'canvas_cream','sign_icon')
    if symbol == 0:  # Tankard and its handle.
        for a,b in [((-.18,.15),(.10,.15)),((-.15,.15),(-.12,-.18)),((-.12,-.18),(.10,-.18)),((.10,-.18),(.13,.15)),((.14,.10),(.24,.10)),((.24,.10),(.24,-.10)),((.24,-.10),(.13,-.10))]:line(a,b)
    elif symbol == 1:  # Loaf with diagonal scoring.
        kit.box((sx,sy+.05,z),(.58,.018,.25),'canvas_cream','sign_icon')
        for x in (-.12,0,.12):
            kit.beam((sx+x-.045,sy+.065,z-.05),(sx+x+.045,sy+.065,z+.06),.025,'timber','sign_icon')
    elif symbol == 2:  # Smith's hammer.
        line((-.11,-.21),(.06,.13),.065)
        line((-.11,.20),(.24,.02),.12)
    elif symbol == 3:  # Draper's folded cloth.
        for k in range(3):
            line((-.21,-.13+k*.12),(.18,-.13+k*.12),.07)
        line((-.21,-.17),(-.21,.18),.04)
    elif symbol == 4:  # Cobbler's boot.
        for a,b in [((-.12,.18),(.08,.18)),((.08,.18),(.08,-.06)),((.08,-.06),(.24,-.12)),((.24,-.12),(.24,-.19)),((.24,-.19),(-.13,-.19)),((-.13,-.19),(-.12,.18))]:line(a,b)
    else:  # Potter's jar.
        for a,b in [((-.10,.19),(.10,.19)),((-.10,.19),(-.08,.08)),((-.08,.08),(-.19,-.02)),((-.19,-.02),(-.11,-.19)),((-.11,-.19),(.11,-.19)),((.11,-.19),(.19,-.02)),((.19,-.02),(.08,.08)),((.08,.08),(.10,.19))]:line(a,b)


def _shop_geometry(c, api, index):
    rid = c['building']['id']
    rng = random.Random(int(hashlib.sha256(('shopfront-v2-'+rid).encode()).hexdigest()[:12],16))
    names = ('tavern', 'bakery', 'smith', 'draper', 'cobbler', 'potter', 'grocer', 'warehouse')
    variant = index % len(names)
    kit = _Kit(c, api, names[variant])
    w, d = c['width'], c['depth']
    aw = w*.70 if variant in (2, 4, 7) else w*.91
    canopy_z = 2.85+rng.uniform(-.18,.15)
    # Awning styles have unequal lengths, heights, stripes, and support patterns.
    if variant in (0, 2, 4, 7):
        for j in range(max(4,int(aw/.25))):
            n=max(4,int(aw/.25)); x=-aw/2+(j+.5)*aw/n
            kit.box((x,d*.52,canopy_z+.14), (aw/n-.018,d*.90,.065), 'canvas' if variant != 7 else 'roof_slate', 'plank_canopy')
        for x in (-aw*.44,aw*.44):
            kit.beam((x,.08,canopy_z-.63),(x,d*.87,canopy_z+.09),.075)
    else:
        count = 7 if variant % 2 else 9
        for i in range(count):
            x0,x1=-aw/2+i*aw/count,-aw/2+(i+1)*aw/count
            mat='canvas_cream' if (i+variant)%3 else ('roof_slate' if variant==3 else 'canvas')
            profile=[(.09,canopy_z+.43),(d*.38,canopy_z+.23),(d*.76,canopy_z+.06),(d*.99,canopy_z)]
            verts=[(x,y,z-rng.uniform(0,.025)) for x in (x0,x1) for y,z in profile]
            kit.poly(verts,[(j,j+1,4+j+1,4+j) for j in range(3)],mat,'striped_awning')
            kit.poly([(x0,d*.99,canopy_z),(x1,d*.99,canopy_z),(x1,d*.99,canopy_z-.17),(x0,d*.99,canopy_z-.17)],[(0,1,2,3)],mat,'awning_valance')
    # A few supported shop porches, while other shops retain projecting brackets.
    if variant in (0, 3, 6):
        for x in (-aw*.46,aw*.46):
            kit.beam((x,d*.88,.08),(x,d*.88,canopy_z),.10)
            kit.beam((x,d*.88,canopy_z-.62),(x+(.42 if x<0 else -.42),d*.88,canopy_z),.065)
        kit.beam((-aw*.48,d*.88,canopy_z),(aw*.48,d*.88,canopy_z),.12)
    # Wide serving hatch; splayed shutter boards are separate from house windows.
    cx=-w*.10
    opening=min(2.05,w*.45)
    kit.box((cx,.102,1.65),(opening,.09,1.48),'glass','serving_hatch')
    for x in (cx-opening/2-.05,cx+opening/2+.05):
        kit.beam((x,.18,.89),(x,.18,2.44),.10)
    kit.beam((cx-opening/2,.18,2.43),(cx+opening/2,.18,2.43),.12)
    for x in (cx-opening*.5-.25,cx+opening*.5+.25):
        for j in range(4):
            kit.box((x+(j-1.5)*.105,.20,1.67),(.095,.065,1.32),'canvas','shutters')
        for z in (1.17,2.15):
            kit.box((x,.244,z),(.43,.035,.065),'timber','shutter_hinges')
        kit.beam((x-.18,.25,1.18),(x+.18,.25,2.12),.045,'timber','shutter_braces')
    # Plank counter and small shop-specific goods, all held inside the checked kit.
    counter_y=min(.70,d*.57)
    for j in range(4):
        kit.box((cx,counter_y+(j-1.5)*.12,1.05),(opening+.18,.112,.065),'canvas','counter')
    for x in (cx-opening*.43,cx+opening*.43):
        kit.beam((x,counter_y+.18,.07),(x,counter_y+.18,1.03),.075)
        kit.beam((x,.14,.48),(x,counter_y+.15,1.01),.055)
    for j in (() if api.get('assetLibrary') else range(5)):
        x=cx+(j-2)*opening*.16
        if variant in (1,6):
            kit.ring((x,counter_y,1.10),.11,.10,'canvas_cream' if variant==1 else 'roof_ochre')
            if j%2:kit.ring((x+.06,counter_y+.14,1.10),.085,.075,'canvas')
        elif variant in (3,4):
            kit.box((x,counter_y,1.15),(.24,.31,.13),'roof_slate' if j%2 else 'canvas_cream','cloth_bundles')
        elif variant in (0,5):
            kit.ring((x,counter_y,1.10),.07,.23,'roof_ochre' if variant==5 else 'canvas_cream')
        elif variant==2:
            kit.beam((x,counter_y-.14,1.12),(x+.08,counter_y+.16,1.12),.035,'metal','tools')
    # Cargo lives at the unused end of the shop, never in its centre doorway.
    cargo_x=w*.35
    if variant in (0,5,7):
        _barrel(kit,cargo_x,d*.48,.86)
    else:
        _crate(kit,cargo_x,d*.49,.04,.47)
        if variant in (1,3,6):_crate(kit,cargo_x+.025,d*.49,.52,.36)
    # Glass lantern on a slender iron hook, with an unmistakable pointed cap.
    lx=-w*.43
    kit.beam((lx,.14,2.68),(lx,.50,2.68),.035,'metal','lantern_hook')
    kit.box((lx,.48,2.35),(.21,.19,.29),'canvas_cream','lantern_glow')
    for xx in (-.12,.12):
        for yy in (-.11,.11):kit.beam((lx+xx,.48+yy,2.18),(lx+xx,.48+yy,2.52),.025,'metal','lantern_frame')
    kit.poly([(lx-.15,.34,2.53),(lx+.15,.34,2.53),(lx+.15,.62,2.53),(lx-.15,.62,2.53),(lx,.48,2.66)],[(0,1,4),(1,2,4),(2,3,4),(3,0,4)],'metal','lantern_roof')
    if not api.get('assetLibrary'):
        _sign(kit,w,d,variant%6)
    if variant==7:
        hz=min(c['building']['eave']-.5,4.9)
        kit.beam((0,.08,hz), (0,d*.9,hz), .16,'timber','warehouse_hoist')
        kit.beam((0,.08,hz-.6), (0,d*.72,hz), .09,'timber','warehouse_hoist')
        kit.beam((0,d*.84,hz), (0,d*.84,2.05), .025,'timber','hoist_rope')
    return kit.finish(), names[variant]


def build_shopfronts(data, building_records, api):
    """Build checked shop kits; return JSON-safe counts and occupied footprints.

    ``api`` supplies mesh, Batch, M and collection. Other renderer helpers may
    be present but are not required. Call after market props to avoid figures
    and stall placements, or use occupied_footprints to reject subsequent props.
    """
    occupied=[]
    existing=api['collection']('03_MARKET_LIFE')
    for obj in existing.objects:
        kind=obj.get('asset_kind','')
        if kind in ('person','market_stall','hand_cart','cargo','statue','well'):
            radius={'person':.33,'market_stall':2.0,'hand_cart':1.5,'cargo':.7,'statue':1.1,'well':1.1}[kind]
            occupied.append(((float(obj.location[0]),float(obj.location[1])),radius))
    if api.get('assetLibrary'):
        for obj in api['collection']('06_AUTHORED_ASSETS').objects:
            if obj.get('asset_mount_role')=='house_entrance':
                occupied.append(((float(obj.matrix_world.translation.x),float(obj.matrix_world.translation.y)),.85))
    for feature in data.get('features',[]):
        if feature.get('kind') != 'fountain':
            continue
        polygon=[_xy(q) for q in feature['points']]
        if not polygon:
            continue
        center=(sum(q[0] for q in polygon)/len(polygon),sum(q[1] for q in polygon)/len(polygon))
        occupied.append((center,max(math.dist(center,q) for q in polygon)+.35))
    candidates=_candidate_shops(data, building_records, occupied)
    stats={'shops':0,'objects':0,'shop_positions':[],'occupied_footprints':[],
           'source_building_ids':[],'recipes':[],'max_projection_m':0.,
           'neighbour_clearance_m':.17,'road_center_clearance_min_m':1.05,
           'planning_footprints_modified':False,'avoided_existing_assets':len(occupied)}
    for i,c in enumerate(candidates):
        count,recipe=_shop_geometry(c,api,i)
        stats['shops']+=1
        stats['objects']+=count
        stats['source_building_ids'].append(c['building']['id'])
        stats['recipes'].append(recipe)
        stats['shop_positions'].append({'building_id':c['building']['id'],'origin':list(c['origin']),
                                        'facade_direction':list(c['t']),'outward':list(c['n']),
                                        'width_m':c['width'],'projection_m':c['depth'],'recipe':recipe})
        stats['occupied_footprints'].append([list(p) for p in c['footprint']])
        stats['max_projection_m']=max(stats['max_projection_m'],c['depth'])
    return stats
