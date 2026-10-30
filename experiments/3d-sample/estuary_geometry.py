"""Source-boundary geometry for one river meeting a single generated coast.

The coastal frame uses +X towards the sea and +Y along the shoreline.  The
generated shore is Y-monotone and the river banks are X-monotone, so their
actual intersections partition two dry banks, a sea polygon and one river
polygon without introducing a general polygon-boolean dependency.
"""
import math

from river_geometry import (EPS, WATER_Z, ROAD_TOP_Z, BED_Z, river_bed_level, xy, area,
                            positive_ring, clip_rectangle, _shores, _path,
                            _clearance, segment_distance, point_in_polygon)

VERSION = 1
SIDES = ('east', 'south', 'west', 'north')


def coastal_frame(side):
    """Return exact quarter-turn local/world transforms, avoiding trig drift."""
    if side not in SIDES:
        raise ValueError('Estuary requires a supported coast side.')
    index = SIDES.index(side)
    local = (lambda p: (p[0], p[1]), lambda p: (p[1], -p[0]),
             lambda p: (-p[0], -p[1]), lambda p: (-p[1], p[0]))[index]
    world = (lambda p: (p[0], p[1]), lambda p: (-p[1], p[0]),
             lambda p: (-p[0], -p[1]), lambda p: (p[1], -p[0]))[index]
    return local, world


def _clean_chain(chain):
    result = []
    for p in chain:
        if not result or math.dist(result[-1], p) > EPS:
            result.append(tuple(p))
    return result


def _at_y(chain, y):
    for a, b in zip(chain, chain[1:]):
        if a[1]-EPS <= y <= b[1]+EPS:
            t = max(0., min(1., (y-a[1])/(b[1]-a[1])))
            return (a[0]+(b[0]-a[0])*t, y)
    raise ValueError('Source shoreline does not span the estuary crop.')


def _slice_y(chain, low, high):
    if high < low-EPS:
        raise ValueError('The two river mouth intersections are reversed.')
    return _clean_chain([_at_y(chain, low)] +
                        [p for p in chain if low+EPS < p[1] < high-EPS] +
                        [_at_y(chain, high)])


def segment_intersection(a, b, c, d):
    """Return t/u/point for two nonparallel closed segments."""
    rx, ry = b[0]-a[0], b[1]-a[1]
    sx, sy = d[0]-c[0], d[1]-c[1]
    denominator = rx*sy-ry*sx
    if abs(denominator) <= 1e-14:
        return None
    qx, qy = c[0]-a[0], c[1]-a[1]
    t, u = (qx*sy-qy*sx)/denominator, (qx*ry-qy*rx)/denominator
    if -EPS <= t <= 1+EPS and -EPS <= u <= 1+EPS:
        t, u = max(0., min(1., t)), max(0., min(1., u))
        # Every consumer shares the same source-coast interpolation.
        return t, u, (c[0]+sx*u, c[1]+sy*u)
    return None


def _trim_shore(chain, coast):
    hits = []
    for i, (a, b) in enumerate(zip(chain, chain[1:])):
        for j, (c, d) in enumerate(zip(coast, coast[1:])):
            hit = segment_intersection(a, b, c, d)
            if hit:
                t, u, p = hit
                if not any(math.dist(p, previous[4]) <= EPS for previous in hits):
                    hits.append((i, t, j, u, p))
    if len(hits) != 1:
        raise ValueError('Each generated river bank must meet the source coast exactly once.')
    i, t, j, u, p = hits[0]
    p = _at_y(coast, p[1])
    trimmed = _clean_chain(chain[:i+1]+[p])
    if len(trimmed) < 2:
        raise ValueError('The estuary must retain an inland river reach.')
    return trimmed, {'riverSegment': i, 'riverParameter': t,
                     'coastSegment': j, 'coastParameter': u, 'point': p}


def _coast_intervals(coast, low, high, ymin, ymax, world):
    dry, mouth = [], []
    for i, (a, b) in enumerate(zip(coast, coast[1:])):
        lo = max(0., (ymin-a[1])/(b[1]-a[1]))
        hi = min(1., (ymax-a[1])/(b[1]-a[1]))
        if hi-lo <= EPS:
            continue
        cuts = sorted({lo, hi, *(max(lo, min(hi, (y-a[1])/(b[1]-a[1])))
                                for y in (low, high))})
        for start, end in zip(cuts, cuts[1:]):
            if end-start <= EPS:
                continue
            y = a[1]+(b[1]-a[1])*(start+end)/2
            p = tuple(a[k]+(b[k]-a[k])*start for k in (0, 1))
            q = tuple(a[k]+(b[k]-a[k])*end for k in (0, 1))
            record = {'sourceSegment': i, 'shoreSegment': i, 'start': start,
                      'end': end, 'a': world(p), 'b': world(q)}
            (mouth if low-EPS <= y <= high+EPS else dry).append(record)
    return dry, mouth


def plan_estuary(source, scale=.5):
    """Return scene-space nonoverlapping water, two banks and source bridges.

    ``water`` is only the river reach outside the sea.  ``seaWater`` retains
    the exact source sea clipped to the crop.  All returned coordinates are
    world scene coordinates, including the segment lists and mouth seam.
    """
    if not math.isfinite(scale) or scale <= 0:
        raise ValueError('Estuary horizontal scale must be positive and finite.')
    river, coast = source.get('river'), source.get('terrain', {}).get('coast')
    if not river or not coast or not river.get('surface'):
        raise ValueError('An estuary needs saved river surface and coastal planning.')
    local, unrotate = coastal_frame(coast.get('side'))
    local_xy = lambda raw: [local(p) for p in xy(raw)]
    raw_river, raw_sea = local_xy(river['surface']), local_xy(coast.get('water', []))
    coast_line = local_xy(coast.get('shoreline', []))
    if len(coast_line) < 2 or any(b[1]-a[1] <= EPS for a, b in zip(coast_line, coast_line[1:])):
        raise ValueError('The generated source coast must be Y-monotone in its coastal frame.')
    if any(not math.isfinite(v) for poly in (raw_river, raw_sea, coast_line) for p in poly for v in p):
        raise ValueError('Estuary source coordinates must be finite.')
    if len(raw_sea) < 4 or area(raw_sea) <= EPS:
        raise ValueError('The source sea must be a nondegenerate polygon.')
    _shores(raw_river)
    raw_crop = xy(source.get('cropPolygon', []))
    if not raw_crop:
        bounds = source['bounds']
        raw_crop = [(bounds['minX'], bounds['minY']), (bounds['maxX'], bounds['minY']),
                    (bounds['maxX'], bounds['maxY']), (bounds['minX'], bounds['maxY'])]
    crop = [local(p) for p in raw_crop]
    bounds = (min(p[0] for p in crop), min(p[1] for p in crop),
              max(p[0] for p in crop), max(p[1] for p in crop))
    xmin, ymin, xmax, ymax = bounds
    if len(crop) != 4 or abs(area(crop)-(xmax-xmin)*(ymax-ymin)) > EPS*max(1., area(crop)):
        raise ValueError('Estuary terrain requires a rectangular crop.')
    shoreline = _slice_y(coast_line, ymin, ymax)
    if any(p[0] <= xmin+EPS or p[0] >= xmax-EPS for p in shoreline):
        raise ValueError('The source coast must leave land and sea inside the scene crop.')
    shores = _shores(clip_rectangle(raw_river, bounds))
    if any(abs(chain[0][0]-xmin) > EPS for chain in shores):
        raise ValueError('The inland end of the estuary must reach the crop edge.')
    trimmed, intersections = zip(*[_trim_shore(chain, coast_line) for chain in shores])
    low_mouth, high_mouth = trimmed[0][-1], trimmed[1][-1]
    if high_mouth[1]-low_mouth[1] <= EPS:
        raise ValueError('The river mouth must have two separated bank intersections.')
    mouth_chain = _slice_y(coast_line, low_mouth[1], high_mouth[1])
    coast_low = _slice_y(coast_line, ymin, low_mouth[1])
    coast_high = _slice_y(coast_line, high_mouth[1], ymax)
    water_local = positive_ring(list(trimmed[0])+mouth_chain[1:]+list(reversed(trimmed[1]))[1:])
    sea_local = clip_rectangle(raw_sea, bounds)
    scale_local = lambda ps: [(p[0]*scale, p[1]*scale) for p in ps]
    world = lambda p: unrotate((p[0]*scale, p[1]*scale))
    scene_world = lambda ps: [world(p) for p in ps]
    to_world_scene = lambda ps: [unrotate(p) for p in ps]
    vertices = {v['id']: (v['x'], v['y']) for v in source.get('vertices', [])}
    raw_roads = source.get('roads', [])
    road_map = {r['id']: r for r in raw_roads}
    roads = [(scale_local([local(p) for p in _path(r, vertices)]), r['width']*scale) for r in raw_roads]
    polygons = [scale_local([local(p) for p in _path(item, vertices)])
                for kind in ('buildings', 'features') for item in source.get(kind, [])
                if len(_path(item, vertices)) >= 3]
    walls = []
    for wall in source.get('walls', []):
        path = scale_local([local(p) for p in _path(wall, vertices)])
        for i, active in enumerate(wall.get('activeSegments', [])):
            if active and len(path) > 1:
                walls.append((path[i], path[(i+1) % len(path)]))
    coast_scene = scale_local(coast_line)
    local_shores = [scale_local(chain) for chain in trimmed]
    target = min(2.2, max(0., float(river.get('bankWidth', 0))*scale*.45))
    land, flat_land, outer, bands, widths = [], [], [], [], []
    def coast_clearance(p):
        return min(segment_distance(p, a, b) for a, b in zip(coast_scene, coast_scene[1:]))
    for index, shore in enumerate(local_shores):
        sign = -1 if index == 0 else 1
        bank_widths = []
        for i, p in enumerate(shore):
            candidates = [_clearance(p, roads, polygons, walls), coast_clearance(p)]
            for j in (i-1, i):
                if 0 <= j < len(shore)-1:
                    a, b = shore[j:j+2]
                    mid = ((a[0]+b[0])/2, (a[1]+b[1])/2)
                    candidates.extend((_clearance(mid, roads, polygons, walls)-math.dist(a, b)/2,
                                       coast_clearance(mid)-math.dist(a, b)/2))
            crop_space = p[1]-ymin*scale if index == 0 else ymax*scale-p[1]
            bank_widths.append(max(0., min(target, crop_space, *candidates)))
        bank_widths[-1] = 0.
        bank_outer = [(p[0], p[1]+sign*w) for p, w in zip(shore, bank_widths)]
        if index == 0:
            coast_part = scale_local(coast_low)
            prefix = [(xmin*scale, ymin*scale)]+coast_part
            ring = prefix+list(reversed(shore))[1:]
            flat_ring = prefix+list(reversed(bank_outer))[1:]
        else:
            suffix = scale_local(coast_high)[1:]+[(xmin*scale, ymax*scale)]
            ring = shore+suffix
            flat_ring = bank_outer+suffix
        land.append(positive_ring(ring)); flat_land.append(positive_ring(flat_ring))
        outer.append(bank_outer); widths.append(bank_widths)
        band = positive_ring(shore+list(reversed(bank_outer)))
        bands.append(band if area(band) > EPS else [])
    water = scene_world(water_local)
    sea = scene_world(sea_local)
    bridges = []
    for bridge in river.get('bridges', []):
        road = road_map.get(bridge['roadId'])
        if road is None:
            raise ValueError('Estuary bridge references a missing source road.')
        points = xy(bridge['points']); road_points = _path(road, vertices)
        if len(points) < 2 or len(points) != len(road_points) or any(math.dist(p, q) > 1e-7 for p, q in zip(points, road_points)):
            raise ValueError('Estuary bridge path must match its source road.')
        width, road_width = float(bridge['width'])*scale, float(road['width'])*scale
        if not math.isfinite(width) or not math.isfinite(road_width) or road_width <= 0 or width < road_width+.5:
            raise ValueError('Estuary bridge width cannot accommodate its road and side structure.')
        path = [(p[0]*scale, p[1]*scale) for p in points]
        if any(point_in_polygon(p, polygon, include_boundary=False)
               for p in (path[0], path[-1]) for polygon in (water, sea)):
            raise ValueError('Estuary bridge endpoints must reach dry land.')
        if not any(point_in_polygon(((a[0]+b[0])/2, (a[1]+b[1])/2), water)
                   for a, b in zip(path, path[1:])):
            raise ValueError('Estuary bridge must cross the actual inland river surface.')
        bridges.append({'id': bridge['id'], 'roadId': bridge['roadId'], 'points': path,
                        'width': width, 'roadWidth': road_width,
                        'sourcePoints': points, 'sourceWidth': bridge['width'], 'sourceRoadWidth': road['width']})
    if not bridges:
        raise ValueError('Estuary cities require at least one source river bridge.')
    world_land = [to_world_scene(ring) for ring in land]
    crop_scene = scene_world(positive_ring(crop))
    difference = abs(area(crop_scene)-area(water)-area(sea)-sum(area(ring) for ring in world_land))
    if difference > max(1e-6, area(crop_scene)*1e-10):
        raise ValueError('Estuary river, sea and land do not partition the source crop.')
    dry_segments, mouth_segments = _coast_intervals(coast_line, low_mouth[1], high_mouth[1], ymin, ymax, world)
    return {'version': VERSION, 'horizontalScale': scale, 'estuary': True,
            'water': water, 'waterParts': [water], 'seaWater': sea,
            'land': world_land, 'flatLand': [to_world_scene(ring) for ring in flat_land],
            'shores': [to_world_scene(chain) for chain in local_shores],
            'bankOuter': [to_world_scene(chain) for chain in outer],
            'bankBands': [to_world_scene(ring) for ring in bands], 'bankWidths': widths,
            'bridges': bridges, 'crop': crop_scene,
            'mouthSegments': mouth_segments, 'coastDrySegments': dry_segments,
            'mouthCoastChain': scene_world(mouth_chain),
            'mouthIntersections': [{'riverSegment': row['riverSegment'], 'riverParameter': row['riverParameter'],
                                    'coastSegment': row['coastSegment'], 'coastParameter': row['coastParameter'],
                                    'point': world(row['point'])} for row in intersections],
            'waterLevel': WATER_Z, 'roadTop': ROAD_TOP_Z, 'bedLevel': river_bed_level(source),
            'naturalBankTargetWidth': target,
            'notes': 'Original sea plus inland river reach; the shared mouth seam is the exact source coastline and carries no quay.'}
