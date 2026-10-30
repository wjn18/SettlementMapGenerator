"""Double precision coverage of the actual triangles of a flat surface.

Blender stores mesh vertices as float32. Its BVH nearest-point calculation can
introduce additional error on thin triangles, even for points inside a face.
Use the saved coordinates directly; height and face orientation are checked
separately by the scene verifier.
"""
import math


def segment_distance(point,a,b):
    dx,dy=b[0]-a[0],b[1]-a[1]
    length=dx*dx+dy*dy
    t=max(0,min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length)) if length else 0
    return math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy)


def triangle_distance(point,triangle):
    a,b,c=triangle
    cross=lambda p,q,r:(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])
    signs=(cross(a,b,point),cross(b,c,point),cross(c,a,point))
    if cross(a,b,c)!=0 and (min(signs)>=0 or max(signs)<=0):return 0.0
    return min(segment_distance(point,p,q) for p,q in ((a,b),(b,c),(c,a)))


def planar_coverage(points,triangles,tolerance):
    """Keep the existing metric tolerance, including on source end caps."""
    distances=[min((triangle_distance(p,t) for t in triangles),default=math.inf) for p in points]
    misses=[{'sampleIndex':i,'pointSceneUnits':list(points[i]),'distanceSceneUnits':d if math.isfinite(d) else None}
            for i,d in enumerate(distances) if d>=tolerance]
    maximum=max(distances,default=0)
    return {'passed':not misses,'method':'float64 XY distance to saved mesh triangles',
            'sampleCount':len(points),'triangleCount':len(triangles),'toleranceSceneUnits':tolerance,
            'maxDistanceSceneUnits':maximum if math.isfinite(maximum) else None,'misses':misses}
