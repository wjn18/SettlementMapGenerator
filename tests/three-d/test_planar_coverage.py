import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'experiments'/'3d-sample'))
from planar_coverage import planar_coverage,triangle_distance


class PlanarCoverageTests(unittest.TestCase):
    def test_saved_r229_triangle_covers_its_source_midpoint_at_original_tolerance(self):
        # Actual saved float32 mesh from seed 1506575625, size 40. BVH nearest
        # reported 0.0000629136 here despite the point lying inside this face.
        triangle=[(179.84060668945312,-38.33781814575195),
                  (178.89901733398438,-45.856693267822266),
                  (179.16127014160156,-45.873077392578125)]
        point=(179.49804006755778,-42.126519511849985)
        for face in (triangle,list(reversed(triangle))):
            report=planar_coverage([point],[face],.00005)
            self.assertTrue(report['passed']);self.assertEqual(report['maxDistanceSceneUnits'],0)
            self.assertEqual(report['toleranceSceneUnits'],.00005)

    def test_real_gap_inside_surface_bounds_is_rejected(self):
        triangles=[[(0,0),(4,0),(0,1)],[(0,3),(4,4),(0,4)]]
        report=planar_coverage([(1,2)],triangles,.00005)
        self.assertFalse(report['passed']);self.assertGreater(report['maxDistanceSceneUnits'],.5)

    def test_empty_and_degenerate_meshes_do_not_cover_the_plane(self):
        for triangles in ([],[[(0,0),(1,0),(2,0)]]):
            self.assertFalse(planar_coverage([(1,1)],triangles,.00005)['passed'])

    def test_end_cap_rounding_keeps_the_existing_tolerance(self):
        triangle=[(0,0),(10,0),(0,10)]
        self.assertTrue(planar_coverage([(-.00002,1)],[triangle],.00005)['passed'])
        report=planar_coverage([(-.001,1)],[triangle],.00005)
        self.assertFalse(report['passed']);self.assertAlmostEqual(report['misses'][0]['distanceSceneUnits'],.001)

    def test_long_thin_translated_triangle_uses_local_differences(self):
        a=(10000,-10000);b=(11000,-9999.99);c=(11000,-9999.98)
        self.assertEqual(triangle_distance((10750,-9999.99),[a,b,c]),0)


if __name__=='__main__':unittest.main()
