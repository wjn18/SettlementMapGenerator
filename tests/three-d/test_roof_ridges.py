"""Regression cases for caps that used to span the entire building length."""
import importlib.util
import math
from pathlib import Path
import unittest

MODULE = Path(__file__).resolve().parents[2] / 'experiments/3d-sample/roof_ridges.py'
spec = importlib.util.spec_from_file_location('roof_ridges', MODULE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RoofRidgeTests(unittest.TestCase):
    def piece(self, planes, polygon=None):
        return {'polygon': polygon or [(-5,-3),(5,-3),(5,3),(-5,3)], 'planes': planes}

    def assert_ends(self, piece, expected):
        segments = module.ridge_segments(piece)
        self.assertEqual(len(segments), 1)
        actual = sorted(tuple(round(v, 6) for v in p) for p in segments[0])
        self.assertEqual(actual, sorted(expected))

    def test_gable_reaches_both_gables(self):
        self.assert_ends(self.piece([(0,1,6),(0,-1,6)]), [(-5,0,6),(5,0,6)])

    def test_hipped_ends_stop_where_the_hip_meets_the_crest(self):
        self.assert_ends(self.piece([(0,1,6),(0,-1,6),(1,0,8),(-1,0,8)]), [(-2,0,6),(2,0,6)])

    def test_half_hip_and_asymmetric_pitch(self):
        self.assert_ends(self.piece([(0,2,6),(0,-1,9),(.5,0,9),(-.5,0,9)]), [(-2,1,8),(2,1,8)])

    def test_broken_pitch_has_one_crest_and_no_caps_on_knees(self):
        self.assert_ends(self.piece([(0,2,9),(0,1,7),(0,-2,9),(0,-1,7)]), [(-5,0,7),(5,0,7)])

    def test_shed_has_no_crest(self):
        self.assertEqual(module.ridge_segments(self.piece([(0,1,6)])), [])

    def test_pyramidal_roof_has_no_horizontal_crest(self):
        self.assertEqual(module.ridge_segments(self.piece([(0,1,6),(0,-1,6),(1,0,6),(-1,0,6)])), [])

    def test_tapered_and_concave_footprints_clip_crest(self):
        self.assert_ends(self.piece([(0,1,6),(0,-1,6)], [(-5,-3),(5,-3),(1,3),(-1,3)]), [(-3,0,6),(3,0,6)])
        piece=self.piece([(0,1,6),(0,-1,6)], [(-5,-3),(5,-3),(5,3),(1,3),(1,-1),(-1,-1),(-1,3),(-5,3)])
        self.assertEqual(sorted(round(math.dist(*s),6) for s in module.ridge_segments(piece)), [4,4])

    def test_rotated_translated_roof(self):
        c,s=math.cos(.7),math.sin(.7)
        def move(p):return (30+c*p[0]-s*p[1],-17+s*p[0]+c*p[1])
        planes=[]
        for a,b,d in [(0,1,6),(0,-1,6),(1,0,8),(-1,0,8)]:
            x,y=a*c-b*s,a*s+b*c
            planes.append((x,y,d-x*30+y*17))
        ends=module.ridge_segments(self.piece(planes,[move(p) for p in [(-5,-3),(5,-3),(5,3),(-5,3)]]))[0]
        for target in [(*move((-2,0)),6),(*move((2,0)),6)]:
            self.assertLess(min(math.dist(p,target) for p in ends),1e-6)


if __name__ == '__main__':
    unittest.main()
