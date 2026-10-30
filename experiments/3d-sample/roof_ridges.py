"""Find supported, horizontal crests of a polygon-clipped plane roof.

The roof is the lower envelope of its planes. A crest is an intersection of
opposing slopes that remains below every other plane and inside the polygon.
This also trims the two ends where hip planes meet a gable's ridge.
"""
import math


def ridge_segments(piece):
    polygon, planes = piece['polygon'], piece['planes']
    result = []
    for i, a in enumerate(planes):
        for b in planes[i + 1:]:
            nx, ny, c = a[0] - b[0], a[1] - b[1], a[2] - b[2]
            size = math.hypot(nx, ny)
            if size < 1e-9:
                continue
            n = (nx / size, ny / size)
            d = (-n[1], n[0])
            # Reject sloping hips and pitch changes on the same side of a roof.
            if abs(a[0] * d[0] + a[1] * d[1]) > 1e-7:
                continue
            if (a[0] * n[0] + a[1] * n[1]) * (b[0] * n[0] + b[1] * n[1]) >= -1e-9:
                continue
            origin = (-c * nx / size**2, -c * ny / size**2)
            crossings = []
            for p, q in zip(polygon, polygon[1:] + polygon[:1]):
                sp = (p[0] - origin[0]) * n[0] + (p[1] - origin[1]) * n[1]
                sq = (q[0] - origin[0]) * n[0] + (q[1] - origin[1]) * n[1]
                if abs(sp) < 1e-7:
                    crossings.append((p[0] - origin[0]) * d[0] + (p[1] - origin[1]) * d[1])
                if sp * sq < 0:
                    t = sp / (sp - sq)
                    x, y = p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])
                    crossings.append((x - origin[0]) * d[0] + (y - origin[1]) * d[1])
            crossings = sorted(set(round(t, 9) for t in crossings))
            for lo, hi in zip(crossings, crossings[1:]):
                x, y = origin[0] + d[0] * (lo + hi) / 2, origin[1] + d[1] * (lo + hi) / 2
                inside = False
                for p, q in zip(polygon, polygon[1:] + polygon[:1]):
                    if (p[1] > y) != (q[1] > y) and x < (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1]) + p[0]:
                        inside = not inside
                if not inside:
                    continue
                for other in planes:
                    # a(origin + d*t) <= other(origin + d*t)
                    slope = (a[0] - other[0]) * d[0] + (a[1] - other[1]) * d[1]
                    rhs = other[2] - a[2] - (a[0] - other[0]) * origin[0] - (a[1] - other[1]) * origin[1]
                    if abs(slope) < 1e-9:
                        if rhs < -1e-7:
                            hi = lo
                            break
                    elif slope > 0:
                        hi = min(hi, rhs / slope)
                    else:
                        lo = max(lo, rhs / slope)
                if hi - lo <= .10:
                    continue
                ends = [(origin[0] + d[0] * t, origin[1] + d[1] * t) for t in (lo, hi)]
                result.append(tuple((x, y, a[0] * x + a[1] * y + a[2]) for x, y in ends))
    return result
