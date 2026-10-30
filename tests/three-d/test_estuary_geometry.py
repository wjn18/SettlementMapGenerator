import copy
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'experiments'/'3d-sample'))
from estuary_geometry import plan_estuary, coastal_frame, segment_intersection
from river_geometry import area, point_in_polygon, triangulate, positive_ring
from harbor_geometry import subtract_convex


def source(curved=False, side='east', harbor=True):
    lower = [(-20., -2.), (-10., -1.5 if curved else -2.),
             (0., -3. if curved else -2.), (10., -.5 if curved else -2.), (12., -1. if curved else -2.)]
    upper = [(x, y+(5.+math.sin(x) if curved else 4.)) for x, y in lower]
    line = [(5.+(.5*math.sin(y*.2) if curved else 0.), y) for y in (-15., -5., 0., 5., 15.)]
    _, world = coastal_frame(side)
    points = [(0., -8.), (0., 8.)]
    mapped = lambda ps: [world(p) for p in ps]
    crop = mapped([(-20., -15.), (20., -15.), (20., 15.), (-20., 15.)])
    return {'bounds': {'minX': min(p[0] for p in crop), 'minY': min(p[1] for p in crop),
                       'maxX': max(p[0] for p in crop), 'maxY': max(p[1] for p in crop)},
            'cropPolygon': crop, 'request': {'river': True, 'coast': side, 'harbor': harbor},
            'river': {'surface': mapped(lower+list(reversed(upper))),
                      'centerline': mapped([(-20., 0.), (12., 0.)]), 'width': 4., 'bankWidth': 4.,
                      'bridges': [{'id': 'bridge0', 'roadId': 'r0', 'points': mapped(points), 'width': 4.}]},
            'terrain': {'coast': {'side': side, 'shoreline': mapped(line),
                                  'water': mapped(positive_ring(line+[(20., 15.), (20., -15.)]))},
                        'waterfronts': [], 'docks': []},
            'roads': [{'id': 'r0', 'points': mapped(points), 'width': 2.}],
            'buildings': [], 'features': [], 'walls': []}


def triangles(poly):
    return [[poly[i] for i in indices] for indices in triangulate(poly)]


class EstuaryGeometryTests(unittest.TestCase):
    def test_four_coasts_preserve_sources_and_partition_land_river_and_sea(self):
        for side in ('east', 'south', 'west', 'north'):
            for curved in (False, True):
                data = source(curved, side)
                before = copy.deepcopy(data)
                plan = plan_estuary(data, .5)
                self.assertEqual(data, before)
                self.assertEqual(len(plan['land']), 2)
                self.assertEqual(plan['seaWater'],
                                 [(p[0]*.5, p[1]*.5) for p in data['terrain']['coast']['water']])
                self.assertAlmostEqual(area(plan['crop']), area(plan['water'])+area(plan['seaWater'])+
                                       sum(area(p) for p in plan['land']), places=8)
                self.assertAlmostEqual(sum(area(p) for p in plan['land']),
                                       sum(area(p) for p in plan['flatLand'])+sum(area(p) for p in plan['bankBands']), places=8)
                rings = [plan['water'], plan['seaWater']]+plan['land']
                for ring in rings+plan['flatLand']:
                    self.assertAlmostEqual(sum(area(t) for t in triangles(ring)), area(ring), places=8)
                for x in range(-9, 10):
                    for y in range(-7, 7):
                        p = (x+.137, y+.219)
                        if not point_in_polygon(p, plan['crop']):
                            continue
                        self.assertEqual(sum(point_in_polygon(p, ring) for ring in rings), 1,
                                         (side, curved, p))

    def test_visible_water_is_exact_source_union_without_double_surface(self):
        for side in ('east', 'south', 'west', 'north'):
            data = source(True, side)
            plan = plan_estuary(data, 1.)
            water, sea = plan['water'], plan['seaWater']
            overlap = 0.
            for a in triangles(water):
                for b in triangles(sea):
                    overlap += area(a)-sum(area(piece) for piece in subtract_convex(a, b))
            self.assertLess(abs(overlap), 1e-8)
            for x in range(-19, 20):
                for y in range(-14, 15):
                    p = (x+.137, y+.219)
                    expected = any(point_in_polygon(p, ring) for ring in
                                   (data['river']['surface'], data['terrain']['coast']['water']))
                    self.assertEqual(any(point_in_polygon(p, ring) for ring in (water, sea)), expected)

    def test_mouth_seam_and_dry_quay_intervals_follow_actual_source_coast(self):
        for side in ('east', 'south', 'west', 'north'):
            data = source(True, side)
            plan = plan_estuary(data, 1.)
            coast = data['terrain']['coast']['shoreline']
            self.assertTrue(plan['mouthSegments'])
            self.assertTrue(plan['coastDrySegments'])
            totals = {}
            for kind in ('mouthSegments', 'coastDrySegments'):
                for part in plan[kind]:
                    a, b = coast[part['sourceSegment']:part['sourceSegment']+2]
                    for key, parameter in (('a', part['start']), ('b', part['end'])):
                        self.assertLess(math.dist(part[key], tuple(a[i]+(b[i]-a[i])*parameter for i in (0, 1))), 1e-9)
                    midpoint = tuple((part['a'][i]+part['b'][i])/2 for i in (0, 1))
                    self.assertEqual(point_in_polygon(midpoint, data['river']['surface']), kind == 'mouthSegments')
                    totals[part['sourceSegment']] = totals.get(part['sourceSegment'], 0.)+part['end']-part['start']
            self.assertEqual(set(totals), set(range(len(coast)-1)))
            for total in totals.values():
                self.assertAlmostEqual(total, 1., places=9)
            self.assertEqual(plan['shores'][0][-1], plan['mouthCoastChain'][0])
            self.assertEqual(plan['shores'][1][-1], plan['mouthCoastChain'][-1])

    def test_bank_slopes_are_partitioned_and_shrink_to_zero_at_the_mouth(self):
        for side in ('east', 'south', 'west', 'north'):
            plan = plan_estuary(source(True, side), 1.)
            for shore, outer, widths in zip(plan['shores'], plan['bankOuter'], plan['bankWidths']):
                self.assertEqual(len(shore), len(outer))
                self.assertEqual(widths[-1], 0.)
                self.assertEqual(shore[-1], outer[-1])
                for p in outer:
                    self.assertFalse(point_in_polygon(p, plan['seaWater'], include_boundary=False))
            self.assertEqual(plan['bankWidths'][0][2], 0.)
            self.assertEqual(plan['bankWidths'][1][2], 0.)

    def test_harbor_switch_does_not_change_the_water_partition_or_source_bridges(self):
        on, off = source(True, harbor=True), source(True, harbor=False)
        a, b = plan_estuary(on), plan_estuary(off)
        for name in ('water', 'seaWater', 'land', 'flatLand', 'bridges', 'mouthSegments'):
            self.assertEqual(a[name], b[name])
        self.assertEqual(a['bridges'][0]['sourcePoints'], on['river']['bridges'][0]['points'])
        self.assertEqual(a['bridges'][0]['width'], 2.)
        self.assertEqual(a['bridges'][0]['roadWidth'], 1.)

    def test_town_vertex_references_and_rotated_crop_are_supported(self):
        data = source(True, 'north')
        points = data['roads'][0].pop('points')
        data['vertices'] = [{'id': 'v'+str(i), 'x': p[0], 'y': p[1]} for i, p in enumerate(points)]
        data['roads'][0]['vertexIds'] = ['v0', 'v1']
        data.pop('cropPolygon')
        self.assertEqual(plan_estuary(data)['bridges'][0]['points'], [(p[0]*.5, p[1]*.5) for p in points])

    def test_missing_mouth_invalid_coast_and_inconsistent_bridges_are_rejected(self):
        changes = [lambda data: data['river'].pop('surface'),
                   lambda data: data['terrain'].pop('coast'),
                   lambda data: data['terrain']['coast'].update(side='diagonal'),
                   lambda data: data['terrain']['coast']['shoreline'].reverse(),
                   lambda data: data['river']['bridges'][0].update(roadId='missing'),
                   lambda data: data['river']['bridges'][0].update(width=2.),
                   lambda data: data['river'].update(bridges=[]),
                   lambda data: data['river']['surface'].__setitem__(1, (-30., -2.))]
        for change in changes:
            data = source()
            change(data)
            with self.assertRaises(ValueError):
                plan_estuary(data)
        data = source()
        data['river']['surface'] = [(-20., -2.), (2., -2.), (2., 2.), (-20., 2.)]
        with self.assertRaises(ValueError):
            plan_estuary(data)
        for scale in (0., -1., float('nan')):
            with self.assertRaises(ValueError):
                plan_estuary(source(), scale)

    def test_segment_intersection_reuses_the_source_coast_point(self):
        hit = segment_intersection((-1., 0.), (3., 0.), (1., -2.), (1., 2.))
        self.assertEqual(hit, (.5, .5, (1., 0.)))
        self.assertIsNone(segment_intersection((0., 0.), (1., 0.), (2., -1.), (2., 1.)))


if __name__ == '__main__':
    unittest.main()
