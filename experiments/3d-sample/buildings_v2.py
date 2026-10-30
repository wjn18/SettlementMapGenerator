"""Footprint-preserving, varied medieval building kit for the second study.

The only ground-contact wall polygon is the untouched input footprint. Roofs
are lower envelopes of affine planes, clipped to that polygon. Long buildings
can have several roof volumes, but never acquire a different ground footprint.
"""
import json
import math
from mathutils import Vector
from spatial_index import BoxIndex


def build_buildings(data, api):
    mesh, Batch, M = api['mesh'], api['Batch'], api['M']
    points, signed_area = api['points'], api['signed_area']
    poly_area, center, inside = api['poly_area'], api['center'], api['inside']
    clip, rng_for = api['clip'], api['rng_for']
    plasters = api['plasters']
    up = Vector((0, 0, 1))
    footprints = {b['id']: points(b['points']) for b in data['buildings']}
    footprint_index=BoxIndex((bid,(min(p[0] for p in poly),max(p[0] for p in poly),min(p[1] for p in poly),max(p[1] for p in poly))) for bid,poly in footprints.items())
    class DiscardedDecoration:
        # The authored kit replaces these exact batches later. Keep their
        # random decisions and roof records, without building disposable meshes.
        def __init__(self,*args,**kwargs):pass
        def beam(self,*args,**kwargs):pass
        def box(self,*args,**kwargs):pass
        def finish(self):pass
    Decoration=DiscardedDecoration if api.get('assetLibrary') else Batch
    plaza = points(data['plaza']['points']) if data.get('plaza') else []
    plaza_center = center(plaza) if plaza else center(points(data['cropPolygon']))
    road_segments = [(a, b, road.get('width', 3)) for road in data['roads']
                     for a, b in zip(points(road['points']), points(road['points'])[1:])]

    def dot(q, n):
        return q[0] * n[0] + q[1] * n[1]

    def plane_height(plane, q):
        return plane[0] * q[0] + plane[1] * q[1] + plane[2]

    def affine(axis, slope, intercept):
        return (axis.x * slope, axis.y * slope, intercept)

    def nearest(q, a, b):
        dx, dy = b[0] - a[0], b[1] - a[1]
        ll = dx * dx + dy * dy
        t = max(0, min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / ll)) if ll > 1e-9 else 0
        return (a[0] + t * dx, a[1] + t * dy)

    def make_planes(poly, u, v, eave, rise, style, r):
        us, vs = [dot(q, u) for q in poly], [dot(q, v) for q in poly]
        u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
        width, length = max(.2, v1 - v0), max(.2, u1 - u0)
        mid = v0 + width * r.uniform(.40, .59)
        left, right = max(.1, mid - v0), max(.1, v1 - mid)
        planes = [affine(v, rise / left, eave - rise * v0 / left),
                  affine(v, -rise / right, eave + rise * v1 / right)]
        if style == 'hipped':
            hiprun = min(length * r.uniform(.22, .33), width * .65)
            planes.extend([affine(u, rise / hiprun, eave - rise * u0 / hiprun),
                           affine(u, -rise / hiprun, eave + rise * u1 / hiprun)])
        elif style == 'half_hip':
            hiprun = min(length * .20, width * .38)
            hiprise = rise * r.uniform(.40, .58)
            planes.extend([affine(u, hiprise / hiprun, eave + rise - hiprise - hiprise * u0 / hiprun),
                           affine(u, -hiprise / hiprun, eave + rise - hiprise + hiprise * u1 / hiprun)])
        elif style == 'broken_pitch':
            # Four cross-section planes: steep lower skirt, gentler upper roof.
            planes = []
            for sign, extent, edge in ((1, left, v0), (-1, right, v1)):
                knee = extent * .32
                steep = rise / (knee + (extent - knee) * .51)
                shallow = steep * .51
                planes.append(affine(v, sign * steep, eave - sign * steep * edge))
                planes.append(affine(v, sign * shallow,
                                     eave + steep * knee - shallow * knee - sign * shallow * edge))
        elif style == 'low_shed':
            planes = [affine(v, rise / width, eave - rise * v0 / width)]
        return planes

    def height(piece, q):
        return min(plane_height(plane, q) for plane in piece['planes'])

    def clean(poly):
        result = []
        for q in poly:
            if not result or math.dist(q, result[-1]) > 1e-7:
                result.append(q)
        if len(result) > 1 and math.dist(result[0], result[-1]) < 1e-7:
            result.pop()
        return result

    def plane_roof(piece):
        faces = []
        for i, plane in enumerate(piece['planes']):
            q = piece['poly'][:]
            for j, other in enumerate(piece['planes']):
                if i == j:
                    continue
                normal = (plane[0] - other[0], plane[1] - other[1])
                rhs = other[2] - plane[2]
                if abs(normal[0]) + abs(normal[1]) < 1e-10:
                    if rhs < -1e-8:
                        q = []
                        break
                else:
                    q = clip(q, normal, rhs, False)
                if len(q) < 3:
                    break
            q = clean(q)
            if len(q) >= 3 and poly_area(q) > 1e-7:
                faces.append((q, plane))
        return faces

    def line_breaks(a, b, planes):
        ts = [0., 1.]
        for i, plane in enumerate(planes):
            for other in planes[i + 1:]:
                h0 = plane_height(plane, a) - plane_height(other, a)
                h1 = plane_height(plane, b) - plane_height(other, b)
                if abs(h0 - h1) > 1e-9:
                    t = h0 / (h0 - h1)
                    if 1e-7 < t < 1 - 1e-7:
                        ts.append(t)
        return sorted(set(round(t, 10) for t in ts))

    def xy_lerp(a, b, t):
        return (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))

    def outward_clear(q, bid, out, distance=.8):
        test = (q[0] + out.x * distance, q[1] + out.y * distance)
        return not any(inside(test,footprints[other]) for other in footprint_index.query((test[0],test[0],test[1],test[1])) if other!=bid)

    records = []
    roof_styles = ['asymmetric_gable', 'half_hip', 'hipped', 'broken_pitch', 'asymmetric_gable', 'half_hip']
    facade_styles = ['end_braces', 'cross_panels', 'close_studding', 'stone_ground']
    for building_index, building in enumerate(data['buildings']):
        bid = building['id']
        p = points(building['points'])
        if signed_area(p) < 0:
            p.reverse()
        r = rng_for(bid + ':architecture-v2')
        edge = max(zip(p, p[1:] + p[:1]), key=lambda pair: math.dist(*pair))
        u = Vector((edge[1][0] - edge[0][0], edge[1][1] - edge[0][1])).normalized()
        v = Vector((-u.y, u.x))
        us, vs = [dot(q, u) for q in p], [dot(q, v) for q in p]
        if max(vs) - min(vs) > max(us) - min(us):
            u, v = v, -u
            us, vs = [dot(q, u) for q in p], [dot(q, v) for q in p]
        length, width = max(us) - min(us), max(vs) - min(vs)
        small = poly_area(p) < 47
        floors = r.choices([1, 2, 3], [17 if small else 5, 68, 15 if small else 27])[0]
        if building.get('wardType') == 'Farm':
            floors = 1 if small else min(floors, 2)
        floor_height = r.uniform(2.70, 3.45)
        eave = floors * floor_height + r.uniform(.10, .65)
        rise = min(width * r.uniform(.48, .69), 7.5)
        style = roof_styles[building_index % len(roof_styles)]
        if floors == 1 and small:
            style = 'low_shed' if building_index % 2 else 'asymmetric_gable'
            rise = min(rise, 2.45)
        facade_style = facade_styles[(building_index + r.randrange(4)) % 4]
        plaster = r.choice(plasters)
        roofmat = M['roof_ochre'] if r.random() < .33 else M['roof_slate']
        # A long ground footprint is a connected hall with additive roof volumes.
        count = 3 if length > 31 else (2 if length > 21 else 1)
        boundaries = [min(us)]
        for j in range(1, count):
            boundaries.append(min(us) + length * (j / count + r.uniform(-.035, .035)))
        boundaries.append(max(us))
        pieces = []
        for part in range(count):
            q = clip(clip(p, u, boundaries[part], True), u, boundaries[part + 1], False)
            if len(q) < 3 or poly_area(q) < .01:
                continue
            part_eave = eave + (r.uniform(-1.25, 1.1) if count > 1 else 0)
            part_width = max(dot(qv, v) for qv in q) - min(dot(qv, v) for qv in q)
            part_rise = min(rise * r.uniform(.87, 1.12), part_width * .72)
            part_style = (['asymmetric_gable', 'half_hip', 'broken_pitch'][(part + building_index) % 3]
                          if count > 1 else style)
            piece = {'poly': q, 'eave': part_eave, 'rise': part_rise,
                     'lo': boundaries[part], 'hi': boundaries[part + 1], 'style': part_style}
            piece['planes'] = make_planes(q, u, v, part_eave, part_rise, part_style, r)
            piece['surfaces'] = plane_roof(piece)
            pieces.append(piece)

        def piece_at(q):
            along = dot(q, u)
            return next((piece for piece in pieces if piece['lo'] - 1e-6 <= along <= piece['hi'] + 1e-6), pieces[-1])

        def roofz(q):
            return height(piece_at(q), q)

        # Every extra vertex on the bottom ring is collinear with an original edge.
        boundary_spans = []
        for side_index, (a, b) in enumerate(zip(p, p[1:] + p[:1])):
            ts = [0., 1.]
            ua, ub = dot(a, u), dot(b, u)
            if abs(ua - ub) > 1e-9:
                ts += [(cut - ua) / (ub - ua) for cut in boundaries[1:-1]
                       if 1e-7 < (cut - ua) / (ub - ua) < 1 - 1e-7]
            ts += line_breaks(a, b, [plane for piece in pieces for plane in piece['planes']])
            ts = sorted(set(round(t, 10) for t in ts))
            for t0, t1 in zip(ts, ts[1:]):
                if t1 - t0 < 1e-7:
                    continue
                aa, bb = xy_lerp(a, b, t0), xy_lerp(a, b, t1)
                piece = piece_at(xy_lerp(a, b, (t0 + t1) / 2))
                boundary_spans.append((aa, bb, height(piece, aa), height(piece, bb), side_index, t0, t1))
        base_ring = [span[0] for span in boundary_spans]
        verts = [(q[0], q[1], .08) for q in base_ring]
        faces, wall_uv, stone_faces = [tuple(range(len(verts) - 1, -1, -1))], [base_ring], []
        for i, (a, b, za, zb, side_index, t0, t1) in enumerate(boundary_spans):
            j = (i + 1) % len(base_ring)
            wall_length = math.dist(p[side_index], p[(side_index + 1) % len(p)])
            x0, x1 = wall_length * t0, wall_length * t1
            band = min(floor_height * .92, za - .15, zb - .15)
            k = len(verts)
            verts.extend([(a[0], a[1], band), (b[0], b[1], band), (a[0], a[1], za), (b[0], b[1], zb)])
            faces.append((i, j, k + 1, k))
            wall_uv.append([(x0, .08), (x1, .08), (x1, band), (x0, band)])
            if facade_style == 'stone_ground':
                stone_faces.append(len(faces) - 1)
            faces.append((k, k + 1, k + 3, k + 2))
            wall_uv.append([(x0, band), (x1, band), (x1, zb), (x0, za)])
        obj = mesh(bid + '_footprint_wall', verts, faces, plaster, uv=wall_uv)
        if stone_faces:
            obj.data.materials.append(M['stone'])
            for index in stone_faces:
                obj.data.polygons[index].material_index = 1
        obj['source_building_id'] = bid
        obj['source_district_id'] = building['districtId']
        obj['base_footprint_json'] = json.dumps(p)
        obj['floors'] = floors
        obj['eave_height_m'] = eave
        obj['roof_type'] = 'stepped_connected_hall' if count > 1 else style
        obj['facade_type'] = facade_style

        oak = Decoration(bid + '_primary_oak', M['timber'])
        secondary = Decoration(bid + '_secondary_joinery', M['timber'])
        rims = Decoration(bid + '_roof_rims', M['ink'])
        caps = Decoration(bid + '_ridge_caps', roofmat)
        glass = Decoration(bid + '_window_recesses', M['glass'])
        leads = Decoration(bid + '_window_leads', M['canvas_cream'])
        shutters = Decoration(bid + '_weathered_shutters', M['timber'])
        iron = Decoration(bid + '_window_iron', M['metal'])
        for part, piece in enumerate(pieces):
            edge_map = {}
            for face_index, (q, plane) in enumerate(piece['surfaces']):
                rv = [(x, y, plane_height(plane, (x, y)) + .115) for x, y in q]
                # Coordinates are projected in metres; compensate slope length.
                plane_v = plane[0] * v.x + plane[1] * v.y
                plane_u = plane[0] * u.x + plane[1] * u.y
                ru = [(dot(qv, u) * math.sqrt(1 + plane_u ** 2),
                       dot(qv, v) * math.sqrt(1 + plane_v ** 2)) for qv in q]
                mesh(bid + '_roof_%d_%d' % (part, face_index), rv,
                     [tuple(range(len(q)))], roofmat, uv=[ru])
                for a, b in zip(rv, rv[1:] + rv[:1]):
                    key = tuple(sorted((tuple(round(x, 5) for x in a), tuple(round(x, 5) for x in b))))
                    edge_map.setdefault(key, []).append((a, b))
            for occurrences in edge_map.values():
                a, b = occurrences[0]
                rims.beam(a, b, .070 if len(occurrences) > 1 else .095)
                if len(occurrences) > 1 and min(a[2], b[2]) > piece['eave'] + piece['rise'] * .70 and abs(a[2] - b[2]) < .35:
                    d = math.dist(a, b)
                    direction = (Vector(b) - Vector(a)).normalized()
                    across = Vector((-direction.y, direction.x, 0)).normalized()
                    cap_count = max(1, int(d / .52))
                    for k in range(cap_count):
                        cc = Vector(a).lerp(Vector(b), (k + .5) / cap_count) + up * .045
                        caps.box(cc, (direction, across, up), (d / cap_count - .025, .30, .12))

        # Close the vertical roof steps where connected volumes meet internally.
        for pa, pb in zip(pieces, pieces[1:]):
            boundary = pa['hi']
            cut_points = [q for q in pa['poly'] if abs(dot(q, u) - boundary) < 1e-5]
            if len(cut_points) < 2:
                continue
            a, b = min(cut_points, key=lambda q: dot(q, v)), max(cut_points, key=lambda q: dot(q, v))
            times = line_breaks(a, b, pa['planes'] + pb['planes'])
            vv, ff, uu = [], [], []
            for t0, t1 in zip(times, times[1:]):
                q0, q1 = xy_lerp(a, b, t0), xy_lerp(a, b, t1)
                ha0, ha1, hb0, hb1 = height(pa, q0), height(pa, q1), height(pb, q0), height(pb, q1)
                if max(abs(ha0 - hb0), abs(ha1 - hb1)) < .005:
                    continue
                k = len(vv)
                vv.extend([(q0[0], q0[1], ha0), (q1[0], q1[1], ha1),
                           (q1[0], q1[1], hb1), (q0[0], q0[1], hb0)])
                ff.append((k, k + 1, k + 2, k + 3))
                uu.append([(dot(q0, v), ha0), (dot(q1, v), ha1), (dot(q1, v), hb1), (dot(q0, v), hb0)])
            if ff:
                mesh(bid + '_roof_step_' + str(len(vv)), vv, ff, plaster, uv=uu)

        facades = []
        for side_index, (a, b) in enumerate(zip(p, p[1:] + p[:1])):
            side_length = math.dist(a, b)
            if side_length < .05:
                continue
            tangent = Vector(((b[0] - a[0]) / side_length, (b[1] - a[1]) / side_length, 0))
            out = Vector((tangent.y, -tangent.x, 0))
            midpoint = xy_lerp(a, b, .5)
            exposed = sum(outward_clear(xy_lerp(a, b, t), bid, out, .75) for t in (.2, .5, .8)) >= 2
            best_road = min(((math.dist(midpoint, nearest(midpoint, ra, rb)), nearest(midpoint, ra, rb), rw)
                             for ra, rb, rw in road_segments), default=(1000, plaza_center, 0))
            to_road = Vector((best_road[1][0] - midpoint[0], best_road[1][1] - midpoint[1], 0))
            to_plaza = Vector((plaza_center[0] - midpoint[0], plaza_center[1] - midpoint[1], 0))
            street = exposed and ((best_road[0] < max(8, best_road[2] * 2) and to_road.dot(out) > .1)
                                  or (to_plaza.dot(out) > 0 and math.dist(midpoint, plaza_center) < 36))
            bays = max(1, round(side_length / r.uniform(2.6, 4.0)))
            bay_width = side_length / bays
            facades.append({'a': list(a), 'b': list(b), 'out': [out.x, out.y], 'length': side_length,
                            'streetFacing': street, 'exposed': exposed, 'bays': bays})
            aa = Vector((a[0], a[1], 0)) + out * .045

            def pos(distance, z, depth=0):
                return aa + tangent * distance + up * z + out * depth

            def local_top(distance):
                q = xy_lerp(a, b, max(0, min(1, distance / side_length)))
                return roofz(q), piece_at(q)['eave']

            def segment_beam(s0, s1, z, width, target=oak, depth=.02):
                # Horizontal frame members terminate at a lowered roof volume.
                if min(local_top(s0)[0], local_top(s1)[0]) > z + .03:
                    target.beam(pos(s0, z, depth), pos(s1, z, depth), width, width * .85)

            for level in range(floors + 1):
                z = .35 if level == 0 else floor_height * level + .15
                for j in range(bays):
                    segment_beam(j * bay_width, (j + 1) * bay_width, z, .19 if level else .23)
            # A second narrow jetty rail introduces depth without moving the wall.
            if floors > 1 and facade_style in ('cross_panels', 'close_studding'):
                segment_beam(0, side_length, floor_height + .38, .12, secondary, .16)
                for k in range(max(2, int(side_length / 1.4))):
                    s = (k + .5) * side_length / max(2, int(side_length / 1.4))
                    secondary.beam(pos(s, floor_height - .13, .02), pos(s, floor_height + .22, .20), .13)
            for j in range(bays + 1):
                s = j * bay_width
                top = local_top(s)[0]
                oak.beam(pos(s, .25), pos(s, top), .19 if j in (0, bays) else .15, .13)
            # Gable edges and the king post read at the district scale.
            for span in boundary_spans:
                if span[4] == side_index:
                    secondary.beam((*span[0], span[2] - .035), (*span[1], span[3] - .035), .13)
            for j in range(bays):
                left, right = j * bay_width, (j + 1) * bay_width
                s = (j + .5) * bay_width
                top, local_eave = local_top(s)
                q = xy_lerp(a, b, s / side_length)
                clear = outward_clear(q, bid, out, .5)
                for floor in range(floors):
                    z0 = floor * floor_height + .23
                    z1 = (floor + 1) * floor_height + .08
                    if z1 > top - .12:
                        continue
                    if facade_style == 'end_braces' and (j in (0, bays - 1) or (floor > 0 and j % 3 == 0)):
                        # Knee braces occupy the upper corner, clear of casements.
                        arm = min(.95, bay_width * .29)
                        if j % 2:
                            secondary.beam(pos(left + .15, z1 - .95), pos(left + arm, z1 - .12), .10, .09)
                        else:
                            secondary.beam(pos(right - .15, z1 - .95), pos(right - arm, z1 - .12), .10, .09)
                    elif facade_style == 'cross_panels' and floor > 0 and j % 2 == 0:
                        sill = z0 + .65
                        secondary.beam(pos(left + .2, z0 + .12), pos(right - .2, sill), .075, .075)
                        secondary.beam(pos(right - .2, z0 + .12), pos(left + .2, sill), .075, .075)
                        segment_beam(left, right, sill + .08, .10, secondary)
                    elif facade_style == 'close_studding' and floor > 0:
                        for fraction in (.22, .78):
                            secondary.beam(pos(left + bay_width * fraction, z0), pos(left + bay_width * fraction, z1), .075, .07)
                    # Ground floor openings remain sparse for separately built shops.
                    if not clear or bay_width < 1.45 or (floor == 0 and (street or r.random() < .32)):
                        continue
                    z = z0 + floor_height * r.uniform(.51, .62)
                    wh = min(r.uniform(.92, 1.45), floor_height * .48)
                    ww = min(r.uniform(.65, 1.03), bay_width * .35)
                    double = bay_width > 3.25 and floor > 0 and r.random() < .36
                    centers = [s - ww * .62, s + ww * .62] if double else [s + r.uniform(-.12, .12)]
                    for ws in centers:
                        glass.box(pos(ws, z, .075), (tangent, out, up), (ww, .09, wh))
                        for dx in (-ww / 2 - .045, ww / 2 + .045):
                            secondary.beam(pos(ws + dx, z - wh / 2, .15), pos(ws + dx, z + wh / 2, .15), .085)
                        for zz in (-wh / 2, wh / 2):
                            secondary.beam(pos(ws - ww / 2 - .08, z + zz, .15), pos(ws + ww / 2 + .08, z + zz, .15), .09)
                        leads.beam(pos(ws, z - wh / 2, .17), pos(ws, z + wh / 2, .17), .035)
                        if r.random() < .74:
                            leads.beam(pos(ws - ww / 2, z + wh * .10, .17), pos(ws + ww / 2, z + wh * .10, .17), .035)
                        shutter_type = r.random()
                        if shutter_type < .38 and not double:
                            for sign in (-1, 1):
                                sw = ww * .46
                                sc = ws + sign * (ww * .5 + sw * .6 + .07)
                                shutters.box(pos(sc, z, .105), (tangent, out, up), (sw, .075, wh + .05))
                                for zz in (-wh * .30, wh * .30):
                                    iron.beam(pos(sc - sw * .40, z + zz, .16), pos(sc + sw * .40, z + zz, .16), .035)
                        elif shutter_type < .50:
                            shutters.box(pos(ws - ww * .25, z, .17), (tangent, out, up), (ww * .48, .07, wh))
                    if floor > 0 and j % 3 == 0 and facade_style != 'stone_ground':
                        # A shallow sill and corbels add relief within 0.3 metres.
                        secondary.box(pos(s, z - wh * .5 - .12, .15), (tangent, out, up), (min(bay_width * .66, 1.6), .24, .13))
                # A gable truss is based on actual roof clearance, not an assumed triangle.
                if top > local_eave + .75:
                    for sign in (-1, 1):
                        ss = s + sign * min(bay_width * .37, 1.3)
                        high = min(local_top(ss)[0] - .15, local_eave + .20)
                        if high < top - .35:
                            secondary.beam(pos(s, top - .20), pos(ss, high), .09)

            # One deliberately uneven service door on exposed non-shop facades.
            if exposed and not street and side_length > 5 and side_index == building_index % len(p):
                ds = side_length * r.uniform(.30, .67)
                glass.box(pos(ds, 1.13, .065), (tangent, out, up), (1.12, .08, 2.18))
                for dx in (-.63, .63):
                    oak.beam(pos(ds + dx, .10, .15), pos(ds + dx, 2.33, .15), .13)
                oak.beam(pos(ds - .67, 2.33, .15), pos(ds + .67, 2.33, .15), .15)
                for k in range(4):
                    secondary.beam(pos(ds - .42 + k * .28, .15, .13), pos(ds - .42 + k * .28, 2.20, .13), .035)

        # Chimneys have varied silhouettes and positions, never one identical center stack.
        chimney_count = (2 if count > 1 else 1) if r.random() < .81 else 0
        chimney = Batch(bid + '_chimney_stacks', M['stone_plain'])
        chimney_caps = Batch(bid + '_chimney_caps', M['stone'])
        chimney_dark = Batch(bid + '_chimney_flues', M['glass'])
        cc = center(p)
        for k in range(chimney_count):
            cp = None
            for attempt in range(12):
                along, across = r.uniform(-.30, .30) * length, r.uniform(-.15, .23) * width
                candidate = (cc[0] + u.x * along + v.x * across, cc[1] + u.y * along + v.y * across)
                corners = [(candidate[0] + dx, candidate[1] + dy) for dx, dy in ((-.7, -.7), (.7, -.7), (.7, .7), (-.7, .7))]
                if all(inside(corner, p) for corner in corners):
                    cp = candidate
                    break
            if cp is None:
                continue
            z = roofz(cp)
            ch = r.uniform(1.65, 2.8)
            cw, cd = r.uniform(.58, .86), r.uniform(.75, 1.15)
            axes = ((u.x, u.y, 0), (v.x, v.y, 0), up)
            chimney.box((cp[0], cp[1], z + ch * .43), axes, (cw, cd, ch + .25))
            chimney_caps.box((cp[0], cp[1], z + ch - .10), axes, (cw + .20, cd + .20, .23))
            chimney_dark.box((cp[0], cp[1], z + ch + .025), axes, (cw * .60, cd * .60, .018))
            if r.random() < .31:
                chimney_caps.box((cp[0], cp[1], z + ch + .38), axes, (cw + .16, cd + .16, .17))
                for sign in (-1, 1):
                    chimney.box((cp[0] + sign * u.x * cw * .33, cp[1] + sign * u.y * cw * .33, z + ch + .18), axes, (.14, cd * .84, .38))

        # Dormers: narrow gable, wider shed, hipped cap, or a paired attic opening.
        dormer_records = []
        dormer_mounts = []
        if width > 4.6 and length > 6.5 and style != 'low_shed':
            desired = 1 + int(count > 1) + int(length > 25)
            for d in range(desired):
                if r.random() > .72:
                    continue
                sg = 1 if v.x * -1 + v.y * -1 > 0 else -1
                normal = Vector((v.x * sg, v.y * sg, 0))
                along = Vector((u.x, u.y, 0))
                dc = Vector((cc[0], cc[1], 0)) + normal * (width * r.uniform(.20, .28))
                dc += along * ((d - (desired - 1) / 2) * min(6.5, length * .27) + r.uniform(-.5, .5))
                kind = (building_index + d) % 3
                dw = r.uniform(1.10, 1.55) if kind != 1 else r.uniform(1.7, 2.5)
                depth = r.uniform(1.25, 1.65)
                corner = [dc - along * dw / 2 - normal * depth / 2,
                          dc + along * dw / 2 - normal * depth / 2,
                          dc + along * dw / 2 + normal * depth / 2,
                          dc - along * dw / 2 + normal * depth / 2]
                if not all(inside((a.x, a.y), p) for a in corner):
                    continue
                if len({pieces.index(piece_at((a.x, a.y))) for a in corner}) != 1:
                    continue
                base = min(roofz((a.x, a.y)) for a in corner) - .08
                back = max(roofz((a.x, a.y)) for a in corner[:2])
                de = max(base + r.uniform(1.2, 1.5), back + .13)
                dv = [(a.x, a.y, base) for a in corner] + [(a.x, a.y, de) for a in corner]
                if kind == 1:
                    dv[4] = (corner[0].x, corner[0].y, de + .36)
                    dv[5] = (corner[1].x, corner[1].y, de + .36)
                    roof_faces = [(4, 5, 6, 7)]
                    wall_faces = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
                    dormer_name = 'shed'
                else:
                    dr = de + r.uniform(.56, .84)
                    ridge_front = dc + normal * (depth / 2 if kind == 0 else depth * .13) + up * dr
                    ridge_back = dc - normal * depth / 2 + up * dr
                    dv.extend([tuple(ridge_back), tuple(ridge_front)])
                    roof_faces = [(4, 8, 9, 7), (8, 5, 6, 9)]
                    wall_faces = [(0, 1, 5, 8, 4), (1, 2, 6, 5), (2, 3, 7, 9, 6), (3, 0, 4, 7)]
                    if kind == 2:
                        roof_faces.append((7, 9, 6))
                        wall_faces[2] = (2, 3, 7, 6)
                    dormer_name = 'gable' if kind == 0 else 'hipped'
                mesh(bid + '_dormer_%d_%s' % (d, dormer_name), dv, wall_faces, plaster)
                roof_uv = [[(dot(dv[i], u), dot(dv[i], v)) for i in face] for face in roof_faces]
                mesh(bid + '_dormer_roof_' + str(d), dv, roof_faces, roofmat, uv=roof_uv)
                for face in roof_faces:
                    for ia, ib in zip(face, face[1:] + face[:1]):
                        rims.beam(dv[ia], dv[ib], .06)
                front = dc + normal * (depth / 2 + .045) + up * (base + (de - base) * .54)
                window_w = min(dw * .64, 1.25)
                window_h = min(1.0, (de - base) * .60)
                glass.box(front, (along, normal, up), (window_w, .08, window_h))
                for sign in (-1, 1):
                    secondary.beam(front + along * (window_w / 2 + .06) * sign - up * window_h / 2,
                                   front + along * (window_w / 2 + .06) * sign + up * window_h / 2, .09)
                for sign in (-1, 1):
                    secondary.beam(front - along * (window_w / 2 + .10) + up * window_h / 2 * sign,
                                   front + along * (window_w / 2 + .10) + up * window_h / 2 * sign, .09)
                leads.beam(front - up * window_h / 2 + normal * .06, front + up * window_h / 2 + normal * .06, .04)
                dormer_records.append(dormer_name)
                dormer_mounts.append({'center': [dc.x, dc.y], 'out': [normal.x, normal.y],
                                      'along': [along.x, along.y], 'base': base,
                                      'width': dw, 'depth': depth, 'eave': de})

        for batch in (oak, secondary, rims, caps, glass, leads, shutters, iron, chimney, chimney_caps, chimney_dark):
            batch.finish()
        records.append({'id': bid, 'wardType': building.get('wardType'), 'districtId': building['districtId'],
                        **({'architecturalRole': building['architecturalRole']} if building.get('architecturalRole') else {}),
                        'footprint': p, 'floors': floors, 'eave': eave,
                        'ridgeHeight': max(plane_height(plane, q) for piece in pieces for q, plane in
                                           ((point, plane) for surface, plane in piece['surfaces'] for point in surface)),
                        'roof': obj['roof_type'], 'roofVolumes': len(pieces),
                        'roofVolumeTypes': [piece['style'] for piece in pieces],
                        'facadeStyle': facade_style, 'facades': facades, 'dormers': dormer_records,
                        'chimneys': chimney_count, 'floorHeight': floor_height,
                        'roofAxes': {'along': list(u), 'across': list(v)},
                        'roofPieces': [{'polygon': piece['poly'], 'planes': piece['planes'],
                                        'eave': piece['eave'], 'lo': piece['lo'], 'hi': piece['hi']}
                                       for piece in pieces], 'dormerMounts': dormer_mounts})
    return records
