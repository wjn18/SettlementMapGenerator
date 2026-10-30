"""Install river wharves and planned vessels using shared harbor assets."""
import json
import math
import bpy
from mathutils import Matrix
from harbor_geometry import xy, inside, ring_samples, overlaps, rectangle
from river_harbor_geometry import river_docks, platform_distance
from river_boats import RIVER_BOAT_ASSETS


def build_river_quays(source, api, place, scale):
    docks=river_docks(source)
    if not docks:return []
    water=[(x*scale,y*scale) for x,y in xy(source['river']['surface'])]
    result=[]
    for i,(a,b) in enumerate(zip(water,water[1:]+water[:1])):
        mid=tuple((a[k]+b[k])/2 for k in (0,1));length=math.dist(a,b)
        if min(platform_distance(p,docks,scale) for p in (a,mid,b))>.8:continue
        u=((b[0]-a[0])/length,(b[1]-a[1])/length);n=(-u[1],u[0])
        if not inside((mid[0]+n[0]*.1,mid[1]+n[1]*.1),water):n=(-n[0],-n[1])
        basis=Matrix(((u[0],-n[0],0,0),(u[1],-n[1],0,0),(0,0,1,0),(0,0,0,1)))
        count=max(1,math.ceil(length/4));names=[]
        for j in range(count):
            t=(j+.5)/count
            # Flush coping is below the deck, with most masonry on the dry side.
            p=(a[0]+(b[0]-a[0])*t-n[0]*.30,a[1]+(b[1]-a[1])*t-n[1]*.30,-.14)
            obj=place('harbor_quay_01',p,(length/count/4,1,1),basis,'harbor_quay_underpass')
            obj['source_waterbody']='river';obj['source_shore_segment']=i;names.append(obj.name)
        result.append({'sourceSegment':i,'objects':names})
    for dock in docks:
        yard=[(x*scale,y*scale) for x,y in xy(dock['riverHarbor']['yard'])]
        obj=api['mesh']('River_harbor_yard_'+dock['id'],[(x,y,.036) for x,y in yard],[tuple(range(len(yard)))],api['M']['ground'],'08_HARBOR')
        obj['source_dock_id']=dock['id'];obj['asset_kind']='river_cargo_yard'
    return result


def place_river_boats(source, entries, place, scale, dock_obstacles, occupied):
    docks=river_docks(source);boats=[]
    if not docks:return boats
    water=[(x*scale,y*scale) for x,y in xy(source['river']['surface'])]
    bridges=[rectangle(a,b,bridge['width']*scale) for bridge in source['river']['bridges']
             for points in [[(x*scale,y*scale) for x,y in xy(bridge['points'])]] for a,b in zip(points,points[1:])]
    for dock in docks:
        berth=dock['riverHarbor']['berth'];aid=RIVER_BOAT_ASSETS[berth['boat']]
        if aid not in entries:raise ValueError('Rebuild the harbor library: missing '+aid)
        entry=entries[aid];lo,hi=entry['bounds']['min'],entry['bounds']['max']
        factor=min(berth['length']*scale/(2*max(abs(lo[0]),abs(hi[0]))),berth['beam']*scale/(2*max(abs(lo[1]),abs(hi[1]))))*.96
        angle=berth['heading'];u=(math.cos(angle),math.sin(angle));n=(-u[1],u[0]);c=(berth['center']['x']*scale,berth['center']['y']*scale)
        ring=[(c[0]+u[0]*x*factor+n[0]*y*factor,c[1]+u[1]*x*factor+n[1]*y*factor) for x,y in ((lo[0],lo[1]),(hi[0],lo[1]),(hi[0],hi[1]),(lo[0],hi[1]))]
        if not all(inside(p,water) for p in ring_samples(ring)) or any(overlaps(ring,p,.10) for p in dock_obstacles+occupied+bridges):
            raise ValueError('Planned river berth cannot fit its authored vessel: '+berth['id'])
        basis=Matrix(((u[0],n[0],0,0),(u[1],n[1],0,0),(0,0,1,0),(0,0,0,1)))
        obj=place(aid,(*c,-1.15),(factor,)*3,basis,'harbor_boat')
        obj['source_dock_id']=dock['id'];obj['source_berth_id']=berth['id'];obj['source_waterbody']='river'
        obj['waterline_z']=-1.15;obj['hull_profile']=json.dumps(entry['hullProfile'])
        occupied.append(ring);boats.append({'object':obj.name,'assetId':aid,'dockId':dock['id'],'berthId':berth['id'],'waterbody':'river','waterlineZ':-1.15,'berthBounds':ring,'scale':factor})
    return boats
