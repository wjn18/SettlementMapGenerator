import math, sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'experiments/3d-sample'))
from bridge_geometry import profile, walking_geometry, height_at, ROAD_Z, ARCH_THICKNESS

class BridgeGeometryTests(unittest.TestCase):
    def test_short_long_rotated_crossings_keep_endpoints_width_and_clearance(self):
        for length in (10,20,32,80):
            for angle in (0,.7,2.8):
                u=(math.cos(angle),math.sin(angle));n=(-u[1],u[0])
                a=(100,-40);b=(a[0]+length*u[0],a[1]+length*u[1]);path=[a,b]
                vertices,faces=walking_geometry(path,7.6)
                self.assertAlmostEqual(height_at(a,path),ROAD_Z)
                self.assertAlmostEqual(height_at(b,path),ROAD_Z)
                for face in faces:
                    p,q,r=[vertices[i] for i in face[:3]]
                    self.assertGreater((q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]),0)
                    for i in face:
                        p=vertices[i];lateral=(p[0]-a[0])*n[0]+(p[1]-a[1])*n[1]
                        self.assertAlmostEqual(abs(lateral),3.8)
                for t in (.4,.5,.6):
                    p=(a[0]+length*u[0]*t,a[1]+length*u[1]*t)
                    self.assertGreaterEqual(height_at(p,path)-ARCH_THICKNESS+1.15,2.2)
                self.assertLessEqual(profile(path)['rise'],4.5)

if __name__=='__main__':unittest.main()
