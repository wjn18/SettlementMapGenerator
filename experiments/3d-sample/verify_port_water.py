"""Independent saved-triangle coverage for water with authored hull exclusions."""
import json
import math
from mathutils import Vector
from harbor_geometry import hull_ring, area


def river_hulls(objects):
    result=[]
    for obj in objects.values():
        if obj.get('asset_mount_role')!='harbor_boat' or obj.get('source_waterbody')!='river':continue
        profile=json.loads(obj.get('hull_profile','{}'))
        if profile:result.append([(p.x,p.y) for x,y in hull_ring(profile) for p in [obj.matrix_world@Vector((x,y,0))]])
    return result


def hull_overlap(triangles, hulls):
    from verify_river import convex_intersection, bounds, boxes_overlap
    return sum(area(convex_intersection(tri,hull)) for tri in triangles for hull in hulls if boxes_overlap(bounds(tri),bounds(hull)))


def verify_cut_river(water, source_triangles, actual, hulls, tolerance):
    from verify_river import overlap_area, convex_intersection, bounds, boxes_overlap
    from planar_coverage import planar_coverage
    source_area=sum(area(tri) for tri,_ in source_triangles)
    actual_area=sum(area(tri) for tri in actual);excluded=sum(area(h) for h in hulls)
    outside=max(0.,actual_area-sum(overlap_area(tri,source_triangles) for tri in actual))
    flooding=hull_overlap(actual,hulls);duplicate=0.
    boxed=[(tri,bounds(tri)) for tri in actual]
    for i,(tri,box) in enumerate(boxed):
        for other,other_box in boxed[:i]:
            if boxes_overlap(box,other_box):duplicate+=area(convex_intersection(tri,other))
    edge_points=water+[tuple((a[k]+b[k])/2 for k in (0,1)) for a,b in zip(water,water[1:]+water[:1])]
    boundary=planar_coverage(edge_points,actual,tolerance)
    allowed=max(.0001,source_area*1e-6)
    passed=boundary['passed'] and outside<=allowed and flooding<=allowed and duplicate<=allowed and abs(actual_area-(source_area-excluded))<=allowed
    return {'kind':'river_hull_water_coverage','passed':passed,'boundary':boundary,'actualArea':actual_area,'expectedArea':source_area-excluded,'hullExclusionArea':excluded,'outsideSourceArea':outside,'floodedHullArea':flooding,'duplicateArea':duplicate,'areaTolerance':allowed}
