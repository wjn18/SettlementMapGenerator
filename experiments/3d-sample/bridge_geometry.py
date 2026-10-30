"""Source-aligned stone arch profiles; all distances are scene units."""
import math

ROAD_Z = .035
ARCH_THICKNESS = .62


def profile(path):
    length = sum(math.dist(a, b) for a, b in zip(path, path[1:]))
    if length <= 1e-6:
        raise ValueError('A stone arch needs a nonzero crossing.')
    return {'length': length, 'rise': min(4.5, max(2.4, length * .14)),
            'thickness': ARCH_THICKNESS, 'style': 'stone-arch'}


def elevation(distance, length, rise):
    t = max(0., min(1., distance / length))
    return ROAD_Z + rise * max(0., math.sin(math.pi * t)) ** 1.3


def segments(path):
    design = profile(path)
    station = 0.
    for a, b in zip(path, path[1:]):
        length = math.dist(a, b)
        if length <= 1e-8:
            continue
        count = max(1, math.ceil(length / .5))
        for i in range(count):
            p = tuple(a[k] + (b[k]-a[k])*i/count for k in (0, 1))
            q = tuple(a[k] + (b[k]-a[k])*(i+1)/count for k in (0, 1))
            yield p, q, elevation(station+length*i/count, design['length'], design['rise']), elevation(station+length*(i+1)/count, design['length'], design['rise'])
        station += length


def height_at(point, path):
    """Height on the piecewise planar walking surface, including its ends."""
    best, z = math.inf, ROAD_Z
    for a, b, za, zb in segments(path):
        dx, dy = b[0]-a[0], b[1]-a[1]
        t = max(0., min(1., ((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy)))
        d = math.hypot(point[0]-a[0]-t*dx, point[1]-a[1]-t*dy)
        if d < best:
            best, z = d, za+(zb-za)*t
    return z


def band_geometry(path, width, lower, upper, side=0.):
    """Closed curved stone band, optionally offset across the source road."""
    vertices, faces = [], []
    for a, b, za, zb in segments(path):
        length = math.dist(a, b); n = (-(b[1]-a[1])/length, (b[0]-a[0])/length)
        ring = [(a[0]+n[0]*(side-width/2), a[1]+n[1]*(side-width/2), za),
                (b[0]+n[0]*(side-width/2), b[1]+n[1]*(side-width/2), zb),
                (b[0]+n[0]*(side+width/2), b[1]+n[1]*(side+width/2), zb),
                (a[0]+n[0]*(side+width/2), a[1]+n[1]*(side+width/2), za)]
        start = len(vertices)
        vertices.extend((x, y, z+offset) for offset in (lower, upper) for x, y, z in ring)
        faces.extend(tuple(start+j for j in f) for f in ((3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)))
    return vertices, faces


def walking_geometry(path, width):
    from road_surface import ribbon_geometry
    vertices, _ = ribbon_geometry(path, width)
    vertices = [(x, y, height_at((x, y), path)) for x, y, _ in vertices]
    faces = []
    for a, b, za, zb in segments(path):
        length = math.dist(a, b); n = (-(b[1]-a[1])/length*width/2, (b[0]-a[0])/length*width/2)
        start = len(vertices)
        vertices.extend(((a[0]-n[0],a[1]-n[1],za),(b[0]-n[0],b[1]-n[1],zb),
                         (b[0]+n[0],b[1]+n[1],zb),(a[0]+n[0],a[1]+n[1],za)))
        faces.append(tuple(start+i for i in range(4)))
    return vertices, faces
