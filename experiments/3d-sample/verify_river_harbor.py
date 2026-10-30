"""Verify planned berths and access against saved geometry, not assembly output."""
import math
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from harbor_geometry import xy, rectangle, inside, overlaps, ring_samples, segment_distance
from river_boats import RIVER_BOAT_ASSETS


def verify_river_harbor(source, manifest, scale):
    expected={d['id']:d for d in source.get('terrain',{}).get('docks',[]) if d.get('waterbody')=='river'}
    checks=[];failures=[]
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    boats=[o for o in objects if o.get('asset_mount_role')=='harbor_boat' and o.get('source_waterbody')=='river']
    def check(ok,message):
        if not ok:failures.append(message)
        return bool(ok)
    check({o.get('source_dock_id') for o in boats}==set(expected) and len(boats)==len(expected),'River vessels do not match the planned berths.')
    def vertices(obj):return [obj.matrix_world@v.co for v in obj.data.vertices]
    bed=next((o for o in objects if o.name=='River_bed'),None)
    bed_tree=BVHTree.FromPolygons(vertices(bed),[tuple(f.vertices) for f in bed.data.polygons]) if bed else None
    def footprint(obj):
        vv=vertices(obj)
        return [(min(p.x for p in vv),min(p.y for p in vv)),(max(p.x for p in vv),min(p.y for p in vv)),(max(p.x for p in vv),max(p.y for p in vv)),(min(p.x for p in vv),max(p.y for p in vv))]
    blockers=[o for o in objects if o.get('source_bridge_id') or o.get('source_wall_id') or o.name.startswith(('Wall_','Original_wall_','River_bank_')) or o.get('asset_mount_role') in ('harbor_quay','harbor_quay_underpass','harbor_bollard')]
    trees=[(o,BVHTree.FromPolygons(vertices(o),[tuple(f.vertices) for f in o.data.polygons])) for o in blockers]
    for did,dock in expected.items():
        plan=dock['riverHarbor'];berth=plan['berth'];rows=[o for o in boats if o.get('source_dock_id')==did]
        ok=len(rows)==1
        if ok:
            obj=rows[0];c=(berth['center']['x']*scale,berth['center']['y']*scale);u=(math.cos(berth['heading']),math.sin(berth['heading']))
            p=obj.matrix_world.translation;forward=obj.matrix_world.to_3x3()@Vector((1,0,0));forward.normalize()
            bound=all(abs((v.x-c[0])*u[0]+(v.y-c[1])*u[1])<=berth['length']*scale/2+1e-4 and abs(-(v.x-c[0])*u[1]+(v.y-c[1])*u[0])<=berth['beam']*scale/2+1e-4 for v in vertices(obj))
            aid=RIVER_BOAT_ASSETS[berth['boat']]
            ok=bound and math.dist((p.x,p.y),c)<1e-4 and forward.x*u[0]+forward.y*u[1]>1-1e-6 and obj.get('source_berth_id')==berth['id'] and obj.get('authored_asset_id')==aid
        check(ok,did+': actual vessel position, heading, asset or dimensions differ from the source berth.')
        checks.append({'kind':'river_berth','dockId':did,'berthId':berth['id'],'passed':ok})
        clearance=None
        if len(rows)==1 and bed_tree:
            hull=vertices(rows[0]);bottom=min(p.z for p in hull)
            low=[p for p in hull if p.z<=bottom+.1]
            hits=[bed_tree.ray_cast(Vector((p.x,p.y,p.z+1e-4)),Vector((0,0,-1)),20)[0] for p in low]
            if hits and all(hit is not None for hit in hits):clearance=min(p.z-hit.z for p,hit in zip(low,hits))
        draft_ok=check(clearance is not None and clearance>=.2-1e-4,did+': actual cargo hull lacks clearance above the river bed.')
        checks.append({'kind':'river_under_keel_clearance','dockId':did,'passed':draft_ok,'minimum':.2,'actual':clearance})
        points=[(x*scale,y*scale) for x,y in xy(dock['points'])];blocked=[]
        for a,b in zip(points,points[1:]):
            length=math.dist(a,b);n=(-(b[1]-a[1])/length,(b[0]-a[0])/length)
            for i in range(max(2,math.ceil(length/.5))+1):
                t=i/max(2,math.ceil(length/.5))
                for offset in (-.38,0,.38):
                    q=(a[0]+(b[0]-a[0])*t+n[0]*offset*dock['width']*scale,a[1]+(b[1]-a[1])*t+n[1]*offset*dock['width']*scale)
                    for obj,tree in trees:
                        if tree.ray_cast(Vector((*q,.045)),Vector((0,0,1)),2.2)[0] is not None:blocked.append(obj.name)
        check(not blocked,did+': bank, quay or wall obstructs the walking approach.')
        checks.append({'kind':'river_dock_access','dockId':did,'passed':not blocked,'blockers':sorted(set(blocked))})
        nav=plan['navigation'];path=[(x*scale,y*scale) for x,y in xy(nav['points'])]
        corridors=[rectangle(a,b,nav['width']*scale) for a,b in zip(path,path[1:])]
        obstacles=[o for o in objects if o.get('source_bridge_id') or o.get('asset_kind')=='exact_dock_base' or o.get('asset_mount_role')=='harbor_boat' and o.get('source_dock_id')!=did]
        collisions=[]
        for obj in obstacles:
            # Use actual transformed vertex hull, including moved bridge parts.
            vv=vertices(obj)
            from mathutils.geometry import convex_hull_2d
            flat=[Vector((p.x,p.y)) for p in vv]
            ring=[tuple(flat[i]) for i in convex_hull_2d(flat)]
            if any(overlaps(ring,q,.01) for q in corridors):collisions.append(obj.name)
        check(not collisions,did+': an actual bridge, dock or vessel blocks the reserved waterway.')
        checks.append({'kind':'river_waterway','dockId':did,'exit':nav['exit'],'passed':not collisions,'blockers':collisions})
    return {'enabled':bool(expected),'version':1,'passed':not failures,'verifiedDocks':len(expected),'checks':checks,'failures':failures}
