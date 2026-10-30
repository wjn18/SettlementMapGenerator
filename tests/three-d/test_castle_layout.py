import importlib.util
import math
from pathlib import Path
import unittest

MODULE=Path(__file__).resolve().parents[2]/'experiments/3d-sample/castle_layout.py'
spec=importlib.util.spec_from_file_location('castle_layout',MODULE)
layout=importlib.util.module_from_spec(spec);spec.loader.exec_module(layout)


class CastleLayoutTests(unittest.TestCase):
    def check_plan(self,poly,along=(0,1),role='keep'):
        plan=layout.plan_keep(poly,along,role)
        self.assertTrue(all(layout.inside(p,poly) and layout.boundary_distance(p,poly)>=.44 for p in plan['roof']['polygon']))
        self.assertLessEqual(len(plan['turrets']),4)
        for turret in plan['turrets']:
            for p in turret['polygon']:
                self.assertTrue(layout.inside(p,poly));self.assertGreaterEqual(layout.boundary_distance(p,poly),.84)
            u=plan['along'];v=plan['across'];c=plan['center'];q=turret['center'];r=plan['roof']
            dot=lambda a,b:a[0]*b[0]+a[1]*b[1]
            self.assertTrue(abs(dot(q,v)-dot(c,v))>(r['width']+turret['size'])/2+.29 or abs(dot(q,u)-dot(c,u))>(r['length']+turret['size'])/2+.29)
        if role=='keep':self.assertGreaterEqual(plan['eave'],17.8)
        return plan

    def test_canonical_keep(self):
        p=self.check_plan([(-6,-8),(6,-8),(6,8),(-6,8)])
        self.assertEqual(len(p['turrets']),4)

    def test_actual_silverhaven_footprint(self):
        p=self.check_plan([(-7.1528604518,68.194620187),(18.922013346,78.579850649),(2.478182347,122.988405119),(-25.43553086,107.891702936)],(-.347244113684,.937774777413))
        self.assertEqual(len(p['turrets']),4)

    def test_small_keep(self):self.check_plan([(-3,-4),(3,-4),(3,4),(-3,4)])

    def test_skewed_keep(self):self.check_plan([(-7,-9),(6,-7),(9,10),(-5,8)])

    def test_concave_keep(self):self.check_plan([(-8,-10),(8,-10),(8,3),(3,3),(3,10),(-8,10)])

    def test_rotated_keep(self):
        c,s=math.cos(.72),math.sin(.72)
        self.check_plan([(40+c*x-s*y,-30+s*x+c*y) for x,y in [(-6,-8),(6,-8),(6,8),(-6,8)]],(-s,c))

    def test_annex_is_lower_and_has_no_main_turrets(self):
        p=self.check_plan([(-6,-8),(6,-8),(6,8),(-6,8)],role='service_hall')
        self.assertFalse(p['turrets']);self.assertLessEqual(p['eave'],9)


if __name__=='__main__':unittest.main()
