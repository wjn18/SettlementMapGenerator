import copy
import math
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'experiments'/'3d-sample'))
from river_geometry import plan_river, area, point_in_polygon, triangulate, clip_rectangle


def source(curve=False):
    lower = [(-20., -2.), (-10., -1.5 if curve else -2.), (0., -3. if curve else -2.),
             (10., -.5 if curve else -2.), (20., -2.)]
    upper = [(x, y+(5.+math.sin(x) if curve else 4.)) for x, y in lower]
    points = [(0., -8.), (0., 8.)]
    return {'bounds': {'minX': -20., 'minY': -15., 'maxX': 20., 'maxY': 15.},
            'cropPolygon': [(-20., -15.), (20., -15.), (20., 15.), (-20., 15.)],
            'river': {'surface': lower+list(reversed(upper)), 'centerline': [(-20., 0.), (20., 0.)],
                      'width': 4., 'bankWidth': 4.,
                      'bridges': [{'id': 'bridge0', 'roadId': 'r0', 'points': points, 'width': 4.}]},
            'roads': [{'id': 'r0', 'points': points, 'width': 2.}],
            'buildings': [], 'features': [], 'walls': []}


class RiverGeometryTests(unittest.TestCase):
    def test_straight_and_curved_variable_width_surfaces_partition_crop(self):
        for curved in (False, True):
            data = source(curved)
            before = copy.deepcopy(data)
            plan = plan_river(data, .5)
            self.assertEqual(data, before, 'planning must not mutate the saved source')
            self.assertEqual(plan['water'], [(p[0]*.5, p[1]*.5) for p in data['river']['surface']])
            self.assertEqual(len(plan['land']), 2)
            self.assertAlmostEqual(area(plan['crop']), area(plan['water'])+sum(area(p) for p in plan['land']), places=9)
            self.assertAlmostEqual(sum(area(p) for p in plan['land']),
                                   sum(area(p) for p in plan['flatLand'])+sum(area(p) for p in plan['bankBands']), places=9)
            for x in range(-9, 10):
                for y in range(-7, 8):
                    p = (x+.123, y+.117)
                    self.assertEqual(sum(point_in_polygon(p, poly) for poly in [plan['water']]+plan['land']), 1)

    def test_ring_start_and_winding_do_not_change_two_banks(self):
        expected = plan_river(source(True))
        for reverse in (False, True):
            data = source(True)
            ring = data['river']['surface']
            ring = ring[3:]+ring[:3]
            data['river']['surface'] = list(reversed(ring)) if reverse else ring
            actual = plan_river(data)
            self.assertEqual(actual['shores'], expected['shores'])
            self.assertEqual(actual['land'], expected['land'])

    def test_bank_slopes_leave_bridge_road_and_building_footprints_clear(self):
        data = source()
        data['buildings'] = [{'id': 'b0', 'points': [(-19., 2.1), (-12., 2.1), (-12., 7.), (-19., 7.)]}]
        plan = plan_river(data, 1.)
        # The bridge crosses both banks at x=0, so no slope may replace the
        # road's level passage. The close building also forces a vertical bank.
        self.assertEqual(plan['bankWidths'][0][2], 0.)
        self.assertEqual(plan['bankWidths'][1][2], 0.)
        self.assertEqual(plan['bankWidths'][1][0], 0.)
        for shore, outer in zip(plan['shores'], plan['bankOuter']):
            self.assertEqual(len(shore), len(outer))
        self.assertEqual(plan['bridges'][0]['width'], 4.)
        self.assertEqual(plan['bridges'][0]['roadWidth'], 2.)

    def test_accepts_town_vertex_references_without_mutation(self):
        data = source()
        data.pop('cropPolygon')
        data['vertices'] = [{'id': 'v0', 'x': 0., 'y': -8.}, {'id': 'v1', 'x': 0., 'y': 8.}]
        data['roads'][0].pop('points')
        data['roads'][0]['vertexIds'] = ['v0', 'v1']
        self.assertEqual(plan_river(data)['bridges'][0]['points'], [(0., -4.), (0., 4.)])

    def test_triangulation_preserves_concave_water_and_land_area(self):
        for ring in [plan_river(source(True))['water']]+plan_river(source(True))['land']:
            triangles = triangulate(ring)
            self.assertAlmostEqual(sum(area([ring[i] for i in tri]) for tri in triangles), area(ring), places=9)
            self.assertTrue(all(point_in_polygon(tuple(sum(ring[i][k] for i in tri)/3 for k in (0, 1)), ring)
                                for tri in triangles))
        ring = [(0., 0.), (2., 0.), (4., 0.), (4., 4.), (2., 2.), (0., 4.)]
        self.assertAlmostEqual(sum(area([ring[i] for i in tri]) for tri in triangulate(ring)), area(ring))

    def test_source_water_can_be_clipped_to_smaller_scene_rectangle(self):
        data = source(True)
        data['cropPolygon'] = [(-15., -15.), (15., -15.), (15., 15.), (-15., 15.)]
        plan = plan_river(data, 1.)
        self.assertAlmostEqual(sum(area(p) for p in plan['land'])+area(plan['water']), 900.)
        self.assertTrue(all(-15. <= p[0] <= 15. for p in plan['water']))

    def test_rejects_unsupported_or_inconsistent_planning(self):
        changes = [lambda x: x['river'].pop('surface'),
                   lambda x: x.update(terrain={'coast': {'side': 'east'}}),
                   lambda x: x['river']['bridges'][0].update(width=1.),
                   lambda x: x['river']['bridges'][0].update(roadId='missing'),
                   lambda x: x['river']['bridges'][0]['points'].__setitem__(0, (0., -1.)),
                   lambda x: x['river'].update(bridges=[]),
                   lambda x: x['river']['surface'].__setitem__(1, (-30., -2.)),
                   lambda x: x['cropPolygon'].__setitem__(0, (-21., -15.))]
        for change in changes:
            data = source()
            change(data)
            with self.assertRaises(ValueError):
                plan_river(data)
        for scale in (0., -1., float('nan')):
            with self.assertRaises(ValueError):
                plan_river(source(), scale)


if __name__ == '__main__':
    unittest.main()
