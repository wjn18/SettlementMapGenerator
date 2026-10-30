"""Source-based river port footprints. No Blender state or replanning."""
import math
from harbor_geometry import xy, rectangle, segment_distance


def river_docks(source):
    return [dock for dock in source.get('terrain', {}).get('docks', []) if dock.get('waterbody') == 'river']


def platform_distance(point, docks, scale):
    return min((segment_distance(point, *[(x*scale,y*scale) for x,y in xy(dock['points'][-2:])])
                - dock['width']*scale/2 for dock in docks), default=math.inf)


def bank_height(point, docks, scale, natural):
    # Shared source vertices use one height function, keeping the bank shell
    # closed through the transition from a level wharf to a natural slope.
    distance = platform_distance(point, docks, scale)
    t = max(0., min(1., (distance-.8)/2.0))
    return natural*t


def berth_ring(berth, scale):
    c=berth['center'];u=(math.cos(berth['heading']),math.sin(berth['heading']))
    a=(c['x']*scale-u[0]*berth['length']*scale/2,c['y']*scale-u[1]*berth['length']*scale/2)
    b=(c['x']*scale+u[0]*berth['length']*scale/2,c['y']*scale+u[1]*berth['length']*scale/2)
    return rectangle(a,b,berth['beam']*scale)
