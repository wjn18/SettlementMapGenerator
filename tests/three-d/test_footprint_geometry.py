import math,random,struct,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'experiments/3d-sample'))
from footprint_geometry import compare_footprints,clip_face,centroid,float32
from spatial_index import BoxIndex

SLIVER=[(110.87233660036645,80.13058215738383),(110.89089193210575,80.19996743120491),
        (.17131439745556065,-49.53921971853727),(.7769458745584927,-49.65918124510797)]
GROVE_F4=[(331.86451129580735,-102.65103112331758),(325.61715118005566,-176.7578297317197),(326.54621059764145,-176.79580036489492)]

class GeometryTests(unittest.TestCase):
    def test_reported_grove_area_matches_its_exact_float32_source(self):
        stored=[tuple(float32(x*.5)/.5 for x in p) for p in GROVE_F4]
        result=compare_footprints(GROVE_F4,stored,.5,1e-4)
        self.assertGreater(result['areaAbsoluteErrorPlanUnitsSquared'],result['areaTolerancePlanUnitsSquared'])
        self.assertEqual(result['areaErrorToFloat32SourcePlanUnitsSquared'],0)
        self.assertTrue(result['passed'])

    def test_grove_deformation_still_fails_area_check_inside_boundary_limit(self):
        stored=[tuple(float32(x*.5)/.5 for x in p) for p in GROVE_F4]
        stored[2]=(stored[2][0]+.00005,stored[2][1])
        result=compare_footprints(GROVE_F4,stored,.5,1e-4)
        self.assertLess(result['maxActualToSourceBoundaryErrorPlanUnits'],1e-4)
        self.assertFalse(result['areaPassed']);self.assertFalse(result['passed'])

    def test_reported_sliver_survives_float32_mesh_storage(self):
        f32=lambda v:struct.unpack('f',struct.pack('f',v))[0]
        stored=[tuple(f32(x*.5)/.5 for x in p) for p in SLIVER]
        result=compare_footprints(SLIVER,stored,.5,1e-4)
        self.assertGreater(result['centroidErrorPlanUnits'],1e-4)
        self.assertLess(result['maxActualToSourceBoundaryErrorPlanUnits'],2e-6)
        self.assertTrue(result['passed'])

    def test_real_movement_is_still_rejected(self):
        moved=[(x+.001,y) for x,y in SLIVER]
        self.assertFalse(compare_footprints(SLIVER,moved,.5,1e-4)['passed'])

    def test_cut_corner_is_rejected_even_when_most_vertices_match(self):
        square=[(0,0),(10,0),(10,10),(0,10)]
        self.assertFalse(compare_footprints(square,[(0,0),(10,0),(8,8),(0,10)],.5,1e-4)['passed'])

    def test_collinear_extra_vertices_do_not_change_footprint(self):
        square=[(0,0),(10,0),(10,10),(0,10)]
        self.assertTrue(compare_footprints(square,[(0,0),(5,0),(10,0),(10,10),(0,10)],.5,1e-4)['passed'])

    def test_centroid_is_stable_far_from_origin(self):
        poly=[(1e8,1e8),(1e8+10,1e8),(1e8+10,1e8+10),(1e8,1e8+10)]
        self.assertEqual(centroid(poly),(1e8+5,1e8+5))

    def test_clipping_retains_interpolated_height_and_uv(self):
        face=[(-1,-1,0,0,0),(2,-1,3,3,0),(2,2,3,3,3),(-1,2,0,0,3)]
        result=clip_face(face,[(0,0),(1,0),(1,1),(0,1)])
        self.assertEqual(len(result),4)
        for x,y,z,u,v in result:
            self.assertTrue(-1e-9<=x<=1+1e-9 and -1e-9<=y<=1+1e-9)
            self.assertAlmostEqual(z,x+1);self.assertAlmostEqual(u,x+1);self.assertAlmostEqual(v,y+1)

    def test_grid_matches_exhaustive_queries_including_long_thin_boxes(self):
        r=random.Random(321);entries=[]
        for i in range(500):
            x,y=r.uniform(-200,200),r.uniform(-200,200)
            entries.append((i,(x,x+r.uniform(.001,70),y,y+r.uniform(.001,70))))
        entries.append((500,(-400,400,-.001,.001)));index=BoxIndex(entries)
        queries=[(-16,0,-16,0),(0,0,0,0)]+[(x,x+12,y,y+12) for x,y in [(r.uniform(-250,250),r.uniform(-250,250)) for _ in range(100)]]
        for q in queries:
            expected=[key for key,b in entries if b[0]<=q[1] and q[0]<=b[1] and b[2]<=q[3] and q[2]<=b[3]]
            self.assertEqual(index.query(q),expected)

if __name__=='__main__':unittest.main()
