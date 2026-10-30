"""Double precision clipping and float32-aware footprint comparisons."""
import math
import struct


def float32(value):
    return struct.unpack('f',struct.pack('f',value))[0]


def float32_radius(point):
    """Maximum XY rounding displacement at this magnitude, not a global epsilon."""
    radii=[]
    for value in point[:2]:
        bits=struct.unpack('I',struct.pack('f',abs(value)))[0]
        middle=float32(abs(value))
        above=struct.unpack('f',struct.pack('I',bits+1))[0]
        below=struct.unpack('f',struct.pack('I',max(0,bits-1)))[0]
        radii.append(max(above-middle,middle-below)*.5)
    return math.hypot(*radii)


def edges(poly):
    return zip(poly, poly[1:] + poly[:1])


def signed_area(poly):
    origin = poly[0]
    return math.fsum((a[0]-origin[0])*(b[1]-origin[1])-(b[0]-origin[0])*(a[1]-origin[1]) for a,b in edges(poly))/2


def centroid(poly):
    origin = poly[0]
    local = [(p[0]-origin[0],p[1]-origin[1]) for p in poly]
    area = signed_area(local)
    if abs(area) < 1e-12:
        raise ValueError('Degenerate footprint')
    return tuple(origin[k]+math.fsum((a[k]+b[k])*(a[0]*b[1]-b[0]*a[1]) for a,b in edges(local))/(6*area) for k in (0,1))


def distance_to_boundary(point, poly):
    distances=[]
    for a,b in edges(poly):
        dx,dy=b[0]-a[0],b[1]-a[1];length=dx*dx+dy*dy
        t=max(0,min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length)) if length else 0
        distances.append(math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy))
    return min(distances)


def compare_footprints(original, actual, scale, tolerance):
    actual_samples=actual+[((a[0]+b[0])/2,(a[1]+b[1])/2) for a,b in edges(actual)]
    source_samples=original+[((a[0]+b[0])/2,(a[1]+b[1])/2) for a,b in edges(original)]
    forward=max(distance_to_boundary(p,original) for p in actual_samples)
    reverse=max(distance_to_boundary(p,actual) for p in source_samples)
    area0,area1=abs(signed_area(original)),abs(signed_area(actual))
    center_error=math.dist(centroid(original),centroid(actual))
    # Blender mesh coordinates are IEEE float32. A long, thin polygon's area
    # centroid is ill-conditioned even when every border vertex is accurate.
    # Measure that representation error from this exact source, while keeping
    # the independent boundary and area limits unchanged.
    rounded=[tuple(float32(x*scale)/scale for x in p) for p in original]
    quantization_error=math.dist(centroid(original),centroid(rounded))
    center_tolerance=tolerance+quantization_error
    area_error=abs(area1-area0);area_tolerance=max(1e-4,area0*1e-5)
    rounded_area=abs(signed_area(rounded))
    area_quantization_error=abs(rounded_area-area0)
    represented_area_error=abs(area1-rounded_area)
    # Thin features far from the origin can lose more relative area during
    # float32 storage than a fixed relative test allows, despite intact edges.
    # Compare to this source's exact representable polygon too. Boundary tests
    # and the existing area tolerance remain independent and unchanged.
    area_passed=min(area_error,represented_area_error)<=area_tolerance
    return {
        'passed':max(forward,reverse)<tolerance and center_error<center_tolerance and area_passed,
        'sourceVertexCount':len(original),'actualBaseVertexCount':len(actual),
        'maxActualToSourceBoundaryErrorPlanUnits':forward,'maxSourceToActualBoundaryErrorPlanUnits':reverse,
        'centroidErrorPlanUnits':center_error,'centroidFloat32ErrorPlanUnits':quantization_error,
        'centroidTolerancePlanUnits':center_tolerance,
        'sourceAreaPlanUnitsSquared':area0,'restoredActualAreaPlanUnitsSquared':area1,
        'actualSceneAreaSquared':area1*scale*scale,'areaAbsoluteErrorPlanUnitsSquared':area_error,
        'areaTolerancePlanUnitsSquared':area_tolerance,
        'sourceFloat32AreaPlanUnitsSquared':rounded_area,'areaFloat32ErrorPlanUnitsSquared':area_quantization_error,
        'areaErrorToFloat32SourcePlanUnitsSquared':represented_area_error,'areaPassed':area_passed,
    }


def clip_face(points, boundary):
    """Clip (x,y,z,u,v) vertices; keep all interpolation in Python float64."""
    for a,b in edges(boundary):
        if not points:break
        out=[]
        distance=lambda p:(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
        for p,q in edges(points):
            dp,dq=distance(p),distance(q);ip,iq=dp>=-1e-10,dq>=-1e-10
            if ip:out.append(p)
            if ip!=iq:
                t=dp/(dp-dq)
                out.append(tuple(x+t*(y-x) for x,y in zip(p,q)))
        points=out
    return points
