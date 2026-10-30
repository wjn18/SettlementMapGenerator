import math
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'experiments'/'3d-sample'))
from harbor_geometry import land_ring, rotate, inside, overlaps, rectangle, ring_samples, area, subtract_convex, hull_ring, compare_sea_boundary
from footprint_geometry import float32


class HarborGeometryTests(unittest.TestCase):
    def test_large_sea_accepts_only_source_float32_representation(self):
        source=[(-167.80510306544875,-1047.2769144605227),(167.80510306544875,-1047.2769144605227),(167.80510306544875,1047.2769144605227),(-167.80510306544875,1047.2769144605227)]
        stored=[tuple(float32(x) for x in p) for p in source]
        report=compare_sea_boundary(source,stored,5e-5)
        self.assertGreater(report['sourceFloat32RoundingMaxSceneUnits'],5e-5)
        self.assertTrue(report['passed'])
        moved=list(stored);moved[0]=(moved[0][0]+.001,moved[0][1])
        self.assertFalse(compare_sea_boundary(source,moved,5e-5)['passed'])
        self.assertFalse(compare_sea_boundary(source,stored+[(1530,0)],5e-5)['passed'])

    def test_land_is_complement_for_all_coast_directions(self):
        # Deliberately nonconvex coastline, including a small bay.
        line=[(1,-10),(3,-5),(.5,0),(2,5),(1,10)]
        sea=line+[(10,10),(10,-10)]
        for i,side in enumerate(('east','south','west','north')):
            angle=i*math.pi/2
            transform=lambda p:rotate(p,angle)
            coast={'side':side,'shoreline':[transform(p) for p in line]}
            crop=[(-10,-10),(10,-10),(10,10),(-10,10)]
            land=land_ring(coast,crop);water=[transform(p) for p in sea]
            for x in range(-9,10):
                for y in range(-9,10):
                    p=transform((x+.13,y+.17))
                    self.assertNotEqual(inside(p,land),inside(p,water),(side,p))

    def test_land_clips_to_crop(self):
        coast={'side':'east','shoreline':[(1,-20),(1,0),(1,20)]}
        ring=land_ring(coast,[(-5,-5),(5,-5),(5,5),(-5,5)])
        self.assertTrue(all(-5-1e-8<=p[0]<=5+1e-8 and -5-1e-8<=p[1]<=5+1e-8 for p in ring))
        self.assertTrue(inside((0,0),ring));self.assertFalse(inside((2,0),ring))

    def test_berths_reject_crossing_edges_and_near_contacts(self):
        a=rectangle((-5,0),(5,0),1);b=rectangle((0,-5),(0,5),1)
        self.assertTrue(overlaps(a,b))
        self.assertTrue(overlaps(a,rectangle((-5,1.2),(5,1.2),1),.3))
        self.assertFalse(overlaps(a,rectangle((-5,2),(5,2),1),.3))

    def test_water_samples_include_long_ship_edges(self):
        ring=rectangle((0,0),(14,0),4)
        self.assertGreater(len(ring_samples(ring)),80)

    def test_water_exclusion_preserves_area_and_outer_boundary(self):
        sea=[(-10,-10),(10,-10),(10,10),(-10,10)]
        for angle in (0,.35,1.7):
            hole=[rotate(p,angle) for p in rectangle((-4,0),(4,0),2)]
            for ring in (hole,list(reversed(hole))):
                pieces=subtract_convex(sea,ring)
                self.assertAlmostEqual(sum(area(p) for p in pieces),area(sea)-area(hole),places=9)
                self.assertTrue(all(not inside((sum(v[0] for v in p)/len(p),sum(v[1] for v in p)/len(p)),hole) for p in pieces))

    def test_exclusion_can_cross_triangle_edges_and_keep_unrelated_water(self):
        hole=[(-1,-1),(1,-1),(1,1),(-1,1)]
        triangles=[[(-10,-10),(10,-10),(10,10)],[(-10,-10),(10,10),(-10,10)]]
        pieces=[p for triangle in triangles for p in subtract_convex(triangle,hole)]
        self.assertAlmostEqual(sum(area(p) for p in pieces),396)
        far=[(20,20),(21,20),(20,21)]
        self.assertEqual(subtract_convex(far,hole),[far])

    def test_waterline_section_interpolates_exterior_not_bounding_box(self):
        profile={'length':8,'width':3,'stations':[(-.5,.02),(0,1),(.5,.02)],'sections':[(-1,.4),(1,1)]}
        ring=hull_ring(profile)
        self.assertEqual(len(ring),6)
        self.assertAlmostEqual(max(p[1] for p in ring),1.05)
        self.assertLess(area(ring),8*3)
        self.assertEqual(hull_ring(profile,2),[])


if __name__=='__main__':unittest.main()
