"""Deterministic geometry for the generated inland, single-channel river.

The supported river has two x-monotone shores and crosses the complete crop
from left to right.  Its *actual* source surface is retained; reference width
and centreline are never used to reconstruct the water boundary.  Coordinates
returned by ``plan_river`` are scene coordinates unless named ``source*``.
No Blender modules or third-party geometry dependencies are required.
"""
import math


VERSION = 1
WATER_Z = -1.15
ROAD_TOP_Z = .035
BED_Z = -2.0
EPS = 1e-9


def river_bed_level(source):
    # Enlarged cargo hulls draw about two scene units below the waterline.
    return -3.6 if any(d.get('waterbody')=='river' for d in source.get('terrain',{}).get('docks',[])) else BED_Z


def xy(raw):
    return [(float(p['x']), float(p['y'])) if isinstance(p, dict)
            else (float(p[0]), float(p[1])) for p in raw]


def signed_area(poly):
    if len(poly) < 3:
        return 0.0
    origin = poly[0]
    return math.fsum((a[0]-origin[0])*(b[1]-origin[1]) -
                     (b[0]-origin[0])*(a[1]-origin[1])
                     for a, b in zip(poly, poly[1:]+poly[:1])) / 2


def area(poly):
    return abs(signed_area(poly))


def segment_distance(p, a, b):
    dx, dy = b[0]-a[0], b[1]-a[1]
    square = dx*dx+dy*dy
    t = max(0., min(1., ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/square)) if square else 0.
    return math.hypot(p[0]-a[0]-t*dx, p[1]-a[1]-t*dy)


def path_distance(p, path):
    return min((segment_distance(p, a, b) for a, b in zip(path, path[1:])),
               default=math.inf)


def point_in_polygon(p, poly, include_boundary=True, tolerance=EPS):
    if len(poly) < 3:
        return False
    if min(segment_distance(p, a, b) for a, b in zip(poly, poly[1:]+poly[:1])) <= tolerance:
        return include_boundary
    hit = False
    for a, b in zip(poly, poly[1:]+poly[:1]):
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]:
            hit = not hit
    return hit


inside = point_in_polygon


def _clean(poly):
    result = []
    for p in poly:
        if not result or math.dist(p, result[-1]) > EPS:
            result.append(tuple(p))
    if len(result) > 1 and math.dist(result[0], result[-1]) <= EPS:
        result.pop()
    return result


def positive_ring(poly):
    result = _clean(poly)
    return result if signed_area(result) >= 0 else list(reversed(result))


def clip_rectangle(poly, bounds):
    """Clip a simple ring against xmin/ymin/xmax/ymax without snapping it."""
    ring = list(poly)
    xmin, ymin, xmax, ymax = bounds
    for axis, value, sign in ((0, xmin, 1), (0, xmax, -1), (1, ymin, 1), (1, ymax, -1)):
        output = []
        for a, b in zip(ring, ring[1:]+ring[:1]):
            da, db = sign*(a[axis]-value), sign*(b[axis]-value)
            ia, ib = da >= -EPS, db >= -EPS
            if ia:
                output.append(a)
            if ia != ib:
                t = da/(da-db)
                p = tuple(a[k]+t*(b[k]-a[k]) for k in (0, 1))
                output.append(p)
        ring = _clean(output)
    return positive_ring(ring)


def rectangle(a, b, width):
    length = math.dist(a, b)
    if length <= EPS:
        raise ValueError('A corridor needs a nonzero segment.')
    nx, ny = -(b[1]-a[1])/length*width/2, (b[0]-a[0])/length*width/2
    return [(a[0]+nx, a[1]+ny), (a[0]-nx, a[1]-ny),
            (b[0]-nx, b[1]-ny), (b[0]+nx, b[1]+ny)]


def point_in_triangle(p, a, b, c, tolerance=EPS):
    cross = lambda u, v, w: (v[0]-u[0])*(w[1]-u[1])-(v[1]-u[1])*(w[0]-u[0])
    values = [cross(a, b, p), cross(b, c, p), cross(c, a, p)]
    return min(values) >= -tolerance or max(values) <= tolerance


def triangulate(poly):
    """Ear-clip a simple ring, returning original vertex index triples."""
    if len(poly) < 3 or area(poly) <= EPS:
        return []
    remaining = list(range(len(poly)))
    if signed_area(poly) < 0:
        remaining.reverse()
    triangles = []
    while len(remaining) > 3:
        found = False
        for position, middle in enumerate(remaining):
            first, last = remaining[position-1], remaining[(position+1) % len(remaining)]
            a, b, c = poly[first], poly[middle], poly[last]
            cross = (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
            if cross <= EPS:
                continue
            if any(point_in_triangle(poly[i], a, b, c) for i in remaining
                   if i not in (first, middle, last)):
                continue
            triangles.append((first, middle, last))
            remaining.pop(position)
            found = True
            break
        if not found:
            # Collinear source points are legal and retain their coordinates
            # on the mesh boundary; they need not form zero-area triangles.
            for position, middle in enumerate(remaining):
                first, last = remaining[position-1], remaining[(position+1) % len(remaining)]
                if segment_distance(poly[middle], poly[first], poly[last]) <= EPS:
                    remaining.pop(position)
                    found = True
                    break
        if not found:
            raise ValueError('Cannot triangulate a non-simple river or land ring.')
    if len(remaining) == 3 and area([poly[i] for i in remaining]) > EPS:
        triangles.append(tuple(remaining))
    return triangles


def _shores(poly):
    """Extract lower and upper left-to-right shore chains from a CCW ring."""
    ring = positive_ring(poly)
    xmin, xmax = min(p[0] for p in ring), max(p[0] for p in ring)
    left = [i for i, p in enumerate(ring) if abs(p[0]-xmin) <= EPS]
    right = [i for i, p in enumerate(ring) if abs(p[0]-xmax) <= EPS]
    if len(left) != 2 or len(right) != 2 or xmax-xmin <= EPS:
        raise ValueError('Inland river needs two banks reaching both crop sides.')
    low_left, high_left = sorted(left, key=lambda i: ring[i][1])
    low_right, high_right = sorted(right, key=lambda i: ring[i][1])

    def walk(start, end, step):
        chain, i = [ring[start]], start
        for _ in range(len(ring)):
            if i == end:
                break
            i = (i+step) % len(ring)
            chain.append(ring[i])
        if i != end or any(b[0]-a[0] <= EPS for a, b in zip(chain, chain[1:])):
            raise ValueError('Only the generated x-monotone inland river is supported.')
        return chain

    shores = [walk(low_left, low_right, 1), walk(high_left, high_right, -1)]
    def height(chain, x):
        a, b = next((a, b) for a, b in zip(chain, chain[1:]) if a[0]-EPS <= x <= b[0]+EPS)
        return a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0])
    for x in sorted({p[0] for chain in shores for p in chain}):
        if height(shores[1], x)-height(shores[0], x) <= EPS:
            raise ValueError('River banks must not cross or touch.')
    return shores


def _path(raw, vertices):
    return xy(raw['points']) if 'points' in raw else [vertices[v] for v in raw.get('vertexIds', raw.get('boundary', []))]


def _clearance(point, roads, polygons, walls):
    clearance = math.inf
    for path, width in roads:
        clearance = min(clearance, path_distance(point, path)-width/2-.12)
    for poly in polygons:
        if point_in_polygon(point, poly):
            return 0.
        clearance = min(clearance, min(segment_distance(point, a, b)
                                      for a, b in zip(poly, poly[1:]+poly[:1]))-.12)
    for a, b in walls:
        clearance = min(clearance, segment_distance(point, a, b)-1.37)
    return max(0., clearance)


def plan_river(source, scale=.5):
    """Derive unchanged-water two-bank terrain and source-linked bridge spans.

    ``source`` accepts selection.json or TownData. Natural-bank widths are
    constrained conservatively by source roads, building/features and walls.
    Width zero means a vertical retaining bank, never moved source geometry.
    """
    if not math.isfinite(scale) or scale <= 0:
        raise ValueError('River horizontal scale must be positive and finite.')
    river = source.get('river')
    if not river:
        raise ValueError('Missing river planning geometry.')
    if source.get('terrain', {}).get('coast'):
        raise ValueError('River mouths are not yet supported by the inland river adapter.')
    if not river.get('surface'):
        raise ValueError('Inland 3D rivers require the saved actual river surface.')
    raw_surface = xy(river['surface'])
    if any(not math.isfinite(v) for p in raw_surface for v in p):
        raise ValueError('River surface coordinates must be finite.')
    if len(raw_surface) < 4 or area(raw_surface) <= EPS:
        raise ValueError('River surface must be a nondegenerate two-bank polygon.')
    _shores(raw_surface)
    crop = xy(source.get('cropPolygon', []))
    if not crop:
        b = source['bounds']
        crop = [(b['minX'], b['minY']), (b['maxX'], b['minY']),
                (b['maxX'], b['maxY']), (b['minX'], b['maxY'])]
    bounds = (min(p[0] for p in crop), min(p[1] for p in crop),
              max(p[0] for p in crop), max(p[1] for p in crop))
    xmin, ymin, xmax, ymax = bounds
    if len(crop) != 4 or abs(area(crop)-(xmax-xmin)*(ymax-ymin)) > EPS*max(1., area(crop)):
        raise ValueError('Inland river terrain requires a rectangular scene crop.')
    water = clip_rectangle(raw_surface, bounds)
    shores = _shores(water)
    if any(abs(chain[0][0]-xmin) > EPS or abs(chain[-1][0]-xmax) > EPS for chain in shores):
        raise ValueError('Inland river must cross the complete scene crop.')
    if any(p[1] <= ymin+EPS or p[1] >= ymax-EPS for chain in shores for p in chain):
        raise ValueError('Inland river must leave dry land on both banks.')
    scene = lambda ps: [(p[0]*scale, p[1]*scale) for p in ps]
    shores = [scene(chain) for chain in shores]
    water = scene(water)
    xmin, ymin, xmax, ymax = (v*scale for v in bounds)
    vertices = {v['id']: (v['x'], v['y']) for v in source.get('vertices', [])}
    raw_roads = source.get('roads', [])
    road_map = {r['id']: r for r in raw_roads}
    roads = [(scene(_path(r, vertices)), r['width']*scale) for r in raw_roads]
    polygons = [scene(_path(item, vertices)) for kind in ('buildings', 'features')
                for item in source.get(kind, []) if len(_path(item, vertices)) >= 3]
    walls = []
    for wall in source.get('walls', []):
        path = scene(_path(wall, vertices))
        for i, active in enumerate(wall.get('activeSegments', [])):
            if active and len(path) > 1:
                walls.append((path[i], path[(i+1) % len(path)]))
    target_width = min(2.2, max(0., float(river.get('bankWidth', 0))*scale*.45))
    outer, widths, bands, flat_land, land = [], [], [], [], []
    for index, shore in enumerate(shores):
        sign = -1 if index == 0 else 1
        bank_widths = []
        for i, p in enumerate(shore):
            candidates = [_clearance(p, roads, polygons, walls)]
            # Distance is 1-Lipschitz: bounding each whole source shore
            # segment by its midpoint minus half length is conservative.
            for j in (i-1, i):
                if 0 <= j < len(shore)-1:
                    a, b = shore[j:j+2]
                    mid = ((a[0]+b[0])/2, (a[1]+b[1])/2)
                    candidates.append(_clearance(mid, roads, polygons, walls)-math.dist(a, b)/2)
            crop_space = p[1]-ymin if index == 0 else ymax-p[1]
            bank_widths.append(max(0., min(target_width, crop_space, *candidates)))
        bank_outer = [(p[0], p[1]+sign*w) for p, w in zip(shore, bank_widths)]
        corners = [(xmin, ymin), (xmax, ymin)] if index == 0 else [(xmax, ymax), (xmin, ymax)]
        land_ring = corners+list(reversed(shore)) if index == 0 else shore+corners
        flat_ring = corners+list(reversed(bank_outer)) if index == 0 else bank_outer+corners
        band = positive_ring(shore+list(reversed(bank_outer)))
        outer.append(bank_outer)
        widths.append(bank_widths)
        bands.append(band if area(band) > EPS else [])
        flat_land.append(positive_ring(flat_ring))
        land.append(positive_ring(land_ring))
    bridges = []
    for bridge in river.get('bridges', []):
        road = road_map.get(bridge['roadId'])
        if road is None:
            raise ValueError('River bridge references a missing source road.')
        points = xy(bridge['points'])
        road_points = _path(road, vertices)
        if len(points) < 2 or len(points) != len(road_points) or any(math.dist(p, q) > 1e-7 for p, q in zip(points, road_points)):
            raise ValueError('River bridge path must match its source road.')
        width, road_width = float(bridge['width'])*scale, float(road['width'])*scale
        if not math.isfinite(width) or not math.isfinite(road_width) or road_width <= 0 or width < road_width+.5:
            raise ValueError('River bridge width cannot accommodate its road and side structure.')
        bridge_points = scene(points)
        if any(point_in_polygon(p, water, include_boundary=False) for p in (bridge_points[0], bridge_points[-1])):
            raise ValueError('River bridge endpoints must reach dry land.')
        if not any(point_in_polygon(((a[0]+b[0])/2, (a[1]+b[1])/2), water)
                   for a, b in zip(bridge_points, bridge_points[1:])):
            raise ValueError('River bridge must cross the actual river surface.')
        bridges.append({'id': bridge['id'], 'roadId': bridge['roadId'], 'points': bridge_points,
                        'width': width, 'roadWidth': road_width,
                        'sourcePoints': points, 'sourceWidth': bridge['width'], 'sourceRoadWidth': road['width']})
    if not bridges:
        raise ValueError('Inland river cities require at least one source bridge.')
    crop_scene = [(xmin, ymin), (xmax, ymin), (xmax, ymax), (xmin, ymax)]
    difference = abs(area(crop_scene)-area(water)-sum(area(p) for p in land))
    if difference > max(1e-6, area(crop_scene)*1e-10):
        raise ValueError('River and dry-land partition do not cover the source crop.')
    return {'version': VERSION, 'horizontalScale': scale,
            'water': water, 'land': land, 'shores': shores, 'bankOuter': outer,
            'bankBands': bands, 'bankWidths': widths, 'flatLand': flat_land,
            'bridges': bridges, 'crop': crop_scene,
            'waterLevel': WATER_Z, 'roadTop': ROAD_TOP_Z, 'bedLevel': river_bed_level(source),
            'naturalBankTargetWidth': target_width,
            'notes': 'Source river surface and bridge paths retained; inland x-monotone channel only. Bank slopes partition dry land and fall back to vertical banks where source occupancy leaves no space.'}
