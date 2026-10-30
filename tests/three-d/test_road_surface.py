import sys,math,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'experiments'/'3d-sample'))
from road_surface import ribbon_geometry,junction_geometry
from harbor_geometry import segment_distance,segment_in_rectangle,area,subtract_convex
from footprint_geometry import float32
from planar_coverage import planar_coverage


class RoadSurfaceTests(unittest.TestCase):
    def test_short_nonzero_source_segment_keeps_continuous_float32_paving(self):
        # A gate approach can contain a sub-millimetre source segment. Its
        # endpoints and the midpoint must remain on the actual saved triangles.
        for points,width in [([(0,0),(10,0),(10.0008,0),(20,0)],4),
            ([(110,45),(114.51877241387014,48.379542148248105),
              (114.51962047834061,48.379976463008205),(150,61)],7.6)]:
            vertices,faces=ribbon_geometry(points,width)
            saved=[tuple(float32(c) for c in p) for p in vertices]
            triangles=[[(saved[i][0],saved[i][1]) for i in face] for face in faces]
            samples=[(a[0]+(b[0]-a[0])*j/8,a[1]+(b[1]-a[1])*j/8)
                     for a,b in zip(points,points[1:]) for j in range(9)]
            report=planar_coverage(samples,triangles,5e-5)
            self.assertTrue(report['passed'],report)
            for triangle in triangles:
                a,b,c=triangle
                self.assertGreater((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),0)
            for i,p in enumerate(triangles):
                for q in triangles[:i]:
                    self.assertLess(area(p)-sum(area(part) for part in subtract_convex(p,q)),1e-4*width*.5)

    def test_bend_has_round_outer_join_inside_reserved_road_width(self):
        for sign in (-1,1):
            points=[(0,0),(10,0),(10,sign*10)];v,f=ribbon_geometry(points,4)
            self.assertGreater(len(v),8);self.assertGreater(len(f),2)
            for p in v[8:]:self.assertLessEqual(min(segment_distance(p[:2],a,b) for a,b in zip(points,points[1:])),2+1e-8)
            self.assertTrue(all(abs(p[2]-.035)<1e-8 for p in v))
            for face in f:
                a,b,c=(v[i] for i in face[:3]);self.assertGreater((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),0)
            polygons=[[v[i][:2] for i in face] for face in f]
            for i,p in enumerate(polygons):
                for q in polygons[:i]:
                    self.assertLess(area(p)-sum(area(part) for part in subtract_convex(p,q)),1e-7)
            expected=76+18*2*math.sin(math.pi/36)
            self.assertAlmostEqual(sum(area(p) for p in polygons),expected,places=6)

    def test_shared_three_way_node_gets_one_continuous_junction(self):
        roads=[{'points':[(0,0),p],'width':4} for p in ((10,0),(0,10),(-10,0))]
        v,f,j=junction_geometry(roads);self.assertEqual(len(j),1);self.assertEqual(len(f),32);self.assertEqual(j[0]['radius'],2)

    def test_two_way_bend_does_not_add_an_unnecessary_junction(self):
        self.assertEqual(junction_geometry([{'points':[(0,0),(10,0),(10,10)],'width':4}])[2],[])

    def test_dock_opening_clips_only_the_intersected_quay_span(self):
        lo,hi=segment_in_rectangle((0,-5),(0,5),(-3,0),(3,0),2.8)
        self.assertAlmostEqual(lo,.36);self.assertAlmostEqual(hi,.64)
        self.assertIsNone(segment_in_rectangle((0,5),(0,10),(-3,0),(3,0),2.8))


if __name__=='__main__':unittest.main()
