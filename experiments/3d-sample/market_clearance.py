"""Blender-independent placement reservations for complete person footprints."""
import math
from river_geometry import xy, path_distance, point_in_polygon, segment_distance


class PlacementReservations:
    def __init__(self, paths=None, water_polygons=None):
        self.paths = []
        for path in paths or []:
            points, width = xy(path.get('points', [])), float(path.get('width', 0))
            if len(points) < 2 or not math.isfinite(width) or width < 0:
                raise ValueError('A reserved passage needs a finite nonnegative width and a path.')
            if any(not math.isfinite(v) for p in points for v in p):
                raise ValueError('Reserved passage coordinates must be finite.')
            self.paths.append((points, width))
        self.water = [];self.water_bounds=[]
        for polygon in water_polygons or []:
            points = xy(polygon)
            if len(points) < 3 or any(not math.isfinite(v) for p in points for v in p):
                raise ValueError('A water reservation needs a finite polygon.')
            self.water.append(points)
            self.water_bounds.append((min(p[0] for p in points),max(p[0] for p in points),min(p[1] for p in points),max(p[1] for p in points)))

    def clear(self, point, radius):
        point = xy([point])[0]
        if not math.isfinite(radius) or radius < 0:
            raise ValueError('A placement footprint radius must be finite and nonnegative.')
        if not all(math.isfinite(v) for v in point):
            raise ValueError('Placement coordinates must be finite.')
        for path, width in self.paths:
            # Segment distance includes the endpoints, reserving the bridge
            # landing as well as every span of a bent source crossing.
            if path_distance(point, path) <= width/2+radius:
                return False
        for polygon,box in zip(self.water,self.water_bounds):
            if point[0]<box[0]-radius or point[0]>box[1]+radius or point[1]<box[2]-radius or point[1]>box[3]+radius:continue
            if point_in_polygon(point, polygon):
                return False
            if min(segment_distance(point, a, b) for a, b in zip(polygon, polygon[1:]+polygon[:1])) <= radius:
                return False
        return True
