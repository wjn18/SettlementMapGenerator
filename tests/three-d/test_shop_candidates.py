import math,sys,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'experiments/3d-sample'))
import shopfronts_v2 as shops


class ExhaustiveIndex:
    def __init__(self,entries=(),**kwargs):self.keys=[key for key,box in entries]
    def query(self,box):return self.keys


class ShopCandidateTests(unittest.TestCase):
    def compare_reference(self,angle):
        c,s=math.cos(angle),math.sin(angle)
        def rotate(p):return (p[0]*c-p[1]*s,p[0]*s+p[1]*c)
        records=[]
        for i,x in enumerate((-30,-10,10,30)):
            for j,y in enumerate((-30,-10,10,30)):
                records.append({'id':f'b{i}-{j}','wardType':'Ward','footprint':list(map(rotate,[(x-4,y-4),(x+4,y-4),(x+4,y+4),(x-4,y+4)]))})
        data={'roads':[{'width':2,'points':[rotate((x,-70)),rotate((x,70))]} for x in (-20,0,20)],
              'districts':[{'wardType':'Market','points':list(map(rotate,[(-8,-8),(8,-8),(8,8),(-8,8)]))}],
              'cropPolygon':list(map(rotate,[(-80,-80),(80,-80),(80,80),(-80,80)]))}
        occupied=[(rotate((0,0)),2)]
        result=shops._candidate_shops(data,records,occupied)
        with patch.object(shops,'BoxIndex',ExhaustiveIndex):reference=shops._candidate_shops(data,records,occupied)
        self.assertEqual(result,reference)
        self.assertEqual(len(result),14)

    def test_matches_all_building_and_road_checks(self):self.compare_reference(0)
    def test_rotated_negative_coordinates_match_exhaustive_selection(self):self.compare_reference(.43)


if __name__=='__main__':unittest.main()
