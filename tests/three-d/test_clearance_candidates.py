"""Broad-phase pruning must match exhaustive geometric decisions."""
import math
import random
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'experiments'/'3d-sample'))
from spatial_index import BoxIndex

def distance(p,a,b):
    dx,dy=b[0]-a[0],b[1]-a[1];ll=dx*dx+dy*dy
    t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/ll)) if ll else 0
    return math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)

class ClearanceCandidates(unittest.TestCase):
    def setUp(self):
        r=random.Random(825131)
        self.roads=[((r.uniform(-100,100),r.uniform(-100,100)),(r.uniform(-100,100),r.uniform(-100,100)),r.uniform(.2,15)) for _ in range(80)]
        self.roads.extend([((0,0),(0,0),4),((-10,0),(10,0),6),((-20,-20),(20,20),2)])
        self.points=[(r.uniform(-130,130),r.uniform(-130,130),r.uniform(.01,4)) for _ in range(400)]
        self.points.extend([(0,3,0),(10,3,.5),(-10,-3,1),(0,0,2)])
    def index(self,expand):
        return BoxIndex((i,(min(a[0],b[0])-expand(w),max(a[0],b[0])+expand(w),min(a[1],b[1])-expand(w),max(a[1],b[1])+expand(w))) for i,(a,b,w) in enumerate(self.roads))
    def test_market_stalls_people_cargo_and_endcaps(self):
        index=self.index(lambda w:max(1.8,w*.35))
        for x,y,r in self.points:
            p=(x,y)
            for threshold,extra in [(lambda w:min(w*.33,1.5)+r,r),(lambda w:max(1.8,w*.35),0),(lambda w:max(1.2,w*.30),0)]:
                exhaustive=all(distance(p,a,b)>threshold(w) for a,b,w in self.roads)
                near=index.query((x-extra,x+extra,y-extra,y+extra))
                optimized=all(distance(p,self.roads[i][0],self.roads[i][1])>threshold(self.roads[i][2]) for i in near)
                self.assertEqual(exhaustive,optimized,(p,r))
    def test_tree_placement_and_actual_mesh_verification(self):
        for expand,margin in [(lambda w:w/2+.2,lambda w,r:w/2+r+.2),(lambda w:w/2,lambda w,r:w/2-.025)]:
            index=self.index(expand)
            for x,y,r in self.points:
                radius=r if margin(0,r)>0 else 0
                # Actual-mesh verification queries the mesh's complete box;
                # point boxes are its smallest limiting case.
                if margin(0,r)<0:radius=0
                p=(x,y);near=index.query((x-radius,x+radius,y-radius,y+radius))
                before=any(distance(p,a,b)<margin(w,r) for a,b,w in self.roads)
                after=any(distance(p,self.roads[i][0],self.roads[i][1])<margin(self.roads[i][2],r) for i in near)
                self.assertEqual(before,after,(p,r))
    def test_nearest_tree_clearance_keeps_the_exact_minimum(self):
        index=self.index(lambda w:w/2+.12)
        for x,y,limit in self.points:
            p=(x,y);near=index.query((x-limit,x+limit,y-limit,y+limit))
            before=min([limit]+[distance(p,a,b)-w/2-.12 for a,b,w in self.roads])
            after=min([limit]+[distance(p,self.roads[i][0],self.roads[i][1])-self.roads[i][2]/2-.12 for i in near])
            self.assertEqual(before,after,(p,limit))

if __name__=='__main__':unittest.main()
