import copy
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'experiments'/'3d-sample'))
from market_clearance import PlacementReservations


class MarketClearanceTests(unittest.TestCase):
    def test_people_clear_the_complete_bridge_width_and_both_landings(self):
        reserved=PlacementReservations([{'points':[(0.,0.),(10.,0.)],'width':4.}])
        self.assertFalse(reserved.clear((5.,0.),.6))
        self.assertFalse(reserved.clear((5.,2.5),.6),'Centre is outside but the body intrudes into the passage.')
        self.assertTrue(reserved.clear((5.,2.7),.6))
        for x in (-1.,11.):
            self.assertFalse(reserved.clear((x,0.),.6),'Both bridge landings need room before the span begins.')
        self.assertTrue(reserved.clear((-3.,0.),.6))

    def test_bent_reserved_paths_cover_every_span_and_joint(self):
        reserved=PlacementReservations([{'points':[(0.,0.),(4.,0.),(4.,6.)],'width':2.}])
        self.assertFalse(reserved.clear((4.,3.),.4))
        self.assertFalse(reserved.clear((4.9,.4),.4))
        self.assertTrue(reserved.clear((2.,3.),.4))

    def test_water_rejects_centres_and_partial_footprints_at_any_bank(self):
        water=[[(0.,0.),(10.,0.),(10.,10.),(0.,10.)]]
        reserved=PlacementReservations(water_polygons=water)
        self.assertFalse(reserved.clear((5.,5.),.5))
        for point in ((-.4,5.),(10.4,5.),(5.,-.4),(5.,10.4)):
            self.assertFalse(reserved.clear(point,.5),'Feet or carried objects may not overhang water.')
        self.assertTrue(reserved.clear((-.7,5.),.5))

    def test_concave_water_and_separate_water_bodies_do_not_fill_dry_land(self):
        polygon=[(0.,0.),(6.,0.),(6.,2.),(2.,2.),(2.,6.),(0.,6.)]
        reserved=PlacementReservations(water_polygons=[polygon,[(8.,0.),(10.,0.),(10.,2.),(8.,2.)]])
        self.assertTrue(reserved.clear((4.,4.),.5))
        self.assertFalse(reserved.clear((9.,1.),.5))
        self.assertTrue(reserved.clear((7.,4.),.5))

    def test_empty_reservations_leave_existing_dry_town_placements_available(self):
        reserved=PlacementReservations()
        self.assertTrue(all(reserved.clear(p,.8) for p in ((0.,0.),(-50.,3.),(20.,-40.))))

    def test_input_remains_unchanged_and_larger_poses_get_more_clearance(self):
        paths=[{'points':[{'x':0.,'y':0.},{'x':10.,'y':0.}],'width':4.}]
        before=copy.deepcopy(paths);reserved=PlacementReservations(paths)
        self.assertTrue(reserved.clear((5.,2.7),.5))
        self.assertFalse(reserved.clear((5.,2.7),.8))
        self.assertEqual(paths,before)

    def test_invalid_or_nonfinite_reservations_are_rejected(self):
        for path in ({'points':[(0.,0.)],'width':2.},
                     {'points':[(0.,0.),(1.,0.)],'width':-1.},
                     {'points':[(0.,0.),(math.inf,0.)],'width':2.}):
            with self.assertRaises(ValueError):
                PlacementReservations([path])
        with self.assertRaises(ValueError):
            PlacementReservations(water_polygons=[[(0.,0.),(1.,0.)]])
        reserved=PlacementReservations()
        for radius in (-.1,math.inf,math.nan):
            with self.assertRaises(ValueError):
                reserved.clear((0.,0.),radius)


if __name__=='__main__':
    unittest.main()
