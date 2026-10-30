import copy
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'experiments/3d-sample'))
from market_placement import MarketOccupancy


class SharedMarketPlacementTests(unittest.TestCase):
    def test_later_market_cannot_place_stall_on_earlier_person(self):
        records=[]
        first=MarketOccupancy(records,'square-a')
        first.reserve((0.,0.),.8,'person','Market square-a / visitor 001')
        later=MarketOccupancy(records,'square-b')
        self.assertFalse(later.clear((1.7,0.),2.4))
        self.assertTrue(later.clear((3.3,0.),2.4))

    def test_later_people_clear_earlier_stalls_and_carried_footprints(self):
        records=[]
        first=MarketOccupancy(records,'a')
        first.reserve((10.,5.),2.4,'market_stall','Market a / stall 01')
        later=MarketOccupancy(records,'b')
        self.assertFalse(later.clear((13.,5.),.8))
        self.assertTrue(later.clear((13.3,5.),.8))

    def test_planned_feature_is_reserved_before_its_market_is_assembled(self):
        records=[{'center':[4.,6.],'radius':2.,'marketId':'b',
                  'kind':'planned_feature','object':None}]
        first=MarketOccupancy(records,'a')
        self.assertFalse(first.clear((4.,7.),.8))
        second=MarketOccupancy(records,'b')
        self.assertTrue(second.clear((4.,7.),.8),'Local feature clearance is handled by the local planner.')

    def test_duplicate_assembly_is_rejected_before_new_objects_are_added(self):
        records=[]
        first=MarketOccupancy(records,'a')
        first.reserve((0.,0.),1.,'well','Market a / well')
        with self.assertRaises(ValueError):MarketOccupancy(records,'a')

    def test_queries_do_not_mutate_input_or_other_market_records(self):
        records=[{'center':[0.,0.],'radius':1.,'marketId':'a','kind':'person','object':'person'}]
        before=copy.deepcopy(records)
        other=MarketOccupancy(records,'b')
        self.assertFalse(other.clear((1.,0.),.5))
        self.assertEqual(records,before)
        other.reserve((5.,0.),.8,'person','Market b / visitor')
        self.assertEqual(records[0],before[0])
        self.assertEqual(records[1]['marketId'],'b')

    def test_legacy_single_market_uses_no_global_occupancy(self):
        legacy=MarketOccupancy()
        legacy.reserve((0.,0.),2.,'market_stall','legacy')
        self.assertTrue(legacy.clear((0.,0.),.5))

    def test_invalid_shared_occupancy_is_rejected(self):
        with self.assertRaises(ValueError):MarketOccupancy([],None)
        for point,radius in [((math.nan,0),1),((0,0),-1),((0,0),math.inf)]:
            with self.assertRaises(ValueError):MarketOccupancy([],'a').reserve(point,radius,'person','invalid')


if __name__=='__main__':unittest.main()
