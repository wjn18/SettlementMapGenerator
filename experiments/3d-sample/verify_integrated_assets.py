"""Inspect saved authored placements independently of the assembly code."""
import bpy
import hashlib
import math
from collections import Counter
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def verify_assets(selection,manifest,scale):
    integration=manifest.get('assetIntegration',{})
    if not integration.get('enabled'):return {'enabled':False,'passed':True,'checks':[],'failures':[]}
    failures=[]
    def check(condition,message):
        if not condition:failures.append(message)
        return bool(condition)
    def xy(raw):return [(p['x']*scale,p['y']*scale) if isinstance(p,dict) else (p[0]*scale,p[1]*scale) for p in raw]
    def edges(poly):return zip(poly,poly[1:]+poly[:1])
    def distance(p,a,b):
        dx,dy=b[0]-a[0],b[1]-a[1];ll=dx*dx+dy*dy
        t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/ll)) if ll else 0
        return math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)
    def boundary(p,poly):return min(distance(p,a,b) for a,b in edges(poly))
    def inside(p,poly):
        hit=False
        for a,b in edges(poly):
            if (a[1]>p[1])!=(b[1]>p[1]) and p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]:hit=not hit
        return hit
    def within(p,poly,tolerance=5e-5):return inside(p,poly) or boundary(p,poly)<tolerance
    def points(obj):return [obj.matrix_world@v.co for v in obj.data.vertices]
    def bbox(poly):return (min(p[0] for p in poly),max(p[0] for p in poly),min(p[1] for p in poly),max(p[1] for p in poly))
    def hits_box(p,box):return box[0]<p[0]<box[1] and box[2]<p[1]<box[3]
    def overlaps(a,b):return a[0]<=b[1] and b[0]<=a[1] and a[2]<=b[3] and b[2]<=a[3]
    planned={b['id']:xy(b['points']) for b in selection['buildings']}
    boxes={bid:bbox(poly) for bid,poly in planned.items()}
    records={r['id']:r for r in manifest['buildings']}
    def roofz(bid,p):
        r=records[bid];u=r['roofAxes']['along'];s=p[0]*u[0]+p[1]*u[1]
        piece=next((q for q in r['roofPieces'] if q['lo']-1e-5<=s<=q['hi']+1e-5),r['roofPieces'][-1])
        return min(a*p[0]+b*p[1]+c for a,b,c in piece['planes'])
    actual={o.name:o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('authored_asset_id')}
    listed={r['object']:r for r in integration['instances']}
    check(len(listed)==len(integration['instances']),'Duplicate authored placement names in the manifest.')
    check(set(actual)==set(listed),'Actual authored meshes differ from the placement manifest.')
    counts=Counter(o.get('authored_asset_id') for o in actual.values())
    check(dict(counts)==integration['assets'],'Actual authored variant counts differ from the manifest.')
    check(len(actual)==integration['meshPlacements'],'Authored mesh count mismatch.')
    check(len(counts)==integration['usedVariants'],'Authored variant count mismatch.')
    library=Path(integration['library'])
    check(library.is_file() and hashlib.sha256(library.read_bytes()).hexdigest()==integration['librarySha256'],'Referenced authored library hash changed or is unavailable.')
    for name,obj in actual.items():
        row=listed.get(name,{})
        check(obj.get('authored_asset_id')==row.get('assetId'),name+': asset identity mismatch.')
        check(obj.get('source_building_id')==row.get('sourceBuildingId'),name+': source building identity mismatch.')
        check(obj.get('source_feature_id')==row.get('sourceFeatureId'),name+': source feature identity mismatch.')
    special_expected={b['id'] for b in selection['buildings'] if b.get('wardType') in ('Cathedral','Farm','PatriciateWard')}
    check({r['buildingId'] for r in integration['specialBuildings']}==special_expected,'Dedicated ward coverage differs from source buildings.')
    groups={}
    for r in integration['cathedralRoles']:groups.setdefault(r['districtId'],[]).append(r)
    for district,roles in groups.items():
        expected={b['id'] for b in selection['buildings'] if b['districtId']==district}
        check({r['buildingId'] for r in roles}==expected,district+': cathedral role assignment omits or adds a building.')
        check(sum(r['role']=='main_hall' for r in roles)==1,district+': expected exactly one main hall.')
        check(sum(r['role']=='bell_tower' for r in roles)==int(len(expected)>1),district+': tower must occupy one existing volume.')
    roof_results=[];facade_results=[]
    facade_roles={'special_facade','patriciate_cornice','timber_panel','house_window','house_entrance','cathedral_window','cathedral_entrance'}
    for name,obj in actual.items():
        row=listed.get(name,{});role=row.get('role');bid=row.get('sourceBuildingId')
        if role in ('footprint_fitted_roof','ridge_detail','dormer','bell_tower_upper'):
            verts=points(obj);bad=[p for p in verts if not within((p.x,p.y),planned[bid])]
            passed=not bad;check(passed,name+': roof or upper tower leaves its original footprint.')
            roof_results.append({'object':name,'buildingId':bid,'role':role,'outsideVertices':len(bad),'passed':passed})
        if role in facade_roles:
            verts=points(obj);obbox=bbox([(p.x,p.y) for p in verts]);near=[other for other,box in boxes.items() if other!=bid and overlaps(box,obbox)]
            conflicts=set()
            # Test vertices and face centers against actual neighboring building
            # height envelopes, so eaves above a lower roof are permitted.
            samples=verts+[obj.matrix_world@face.center for face in obj.data.polygons]
            for other in near:
                for p in samples:
                    q=(p.x,p.y)
                    if hits_box(q,boxes[other]) and inside(q,planned[other]) and boundary(q,planned[other])>.025 and .08<p.z<roofz(other,q)-.025:
                        conflicts.add(other);break
            passed=not conflicts;check(passed,name+': facade intersects neighboring building volume '+str(sorted(conflicts)))
            facade_results.append({'object':name,'buildingId':bid,'conflicts':sorted(conflicts),'passed':passed})
    vegetation=[]
    features={f['id']:xy(f['points']) for f in selection.get('features',[])}
    roads=[(a,b,r['width']*scale) for r in selection['roads'] for poly in [xy(r['points'])] for a,b in zip(poly,poly[1:])]
    for name,obj in actual.items():
        if listed.get(name,{}).get('role') not in ('grove_tree','grove_shrub'):continue
        fid=obj.get('source_feature_id');verts=points(obj);outline=[(p.x,p.y) for p in verts];box=bbox(outline)
        near=[bid for bid,b in boxes.items() if overlaps(box,b)]
        outside=sum(not within(p,features[fid]) for p in outline)
        conflicts=[bid for bid in near if any(inside(p,planned[bid]) and boundary(p,planned[bid])>.025 for p in outline)]
        road_conflicts=any(distance(p,a,b)<w/2-.025 for p in outline for a,b,w in roads)
        passed=not outside and not conflicts and not road_conflicts
        check(passed,name+': vegetation exceeds grove, building or road constraints.')
        vegetation.append({'object':name,'featureId':fid,'outsideVertices':outside,'buildingConflicts':conflicts,'roadConflict':road_conflicts,'passed':passed})
    gate_results=[]
    for gate in integration['gates']:
        trees=[]
        objects=[bpy.data.objects.get(name) for name in gate['objects']]
        check(all(o is not None for o in objects),'A gate attachment is absent from the saved scene.')
        for obj in objects:
            if obj is not None:trees.append((obj.name,BVHTree.FromPolygons(points(obj),[list(f.vertices) for f in obj.data.polygons])))
        t=Vector((*gate['along'],0));n=Vector((*gate['normal'],0));c=Vector((*gate['origin'],0))
        half=min(1.5,gate['width']*.28);blocked=[]
        for x in (-half,-half*.5,0,half*.5,half):
            for z in (.25,.7,1.4,2.1):
                origin=c+t*x-n*3+Vector((0,0,z))
                for name,tree in trees:
                    if tree.ray_cast(origin,n,6)[0] is not None:blocked.append(name)
        passed=not blocked;check(passed,'Authored gate attachments obstruct a pedestrian passage: '+str(gate['index']))
        gate_results.append({'wallId':gate['wallId'],'gateIndex':gate['index'],'sampledWidth':half*2,'sampledHeights':[.25,.7,1.4,2.1],
                             'blockingObjects':sorted(set(blocked)),'passed':passed})
    courtyard=[]
    districts={d['id']:xy(d['points']) for d in selection['districts']}
    for name,obj in actual.items():
        if listed.get(name,{}).get('role')!='courtyard_decoration':continue
        outline=[(p.x,p.y) for p in points(obj)];district=obj.get('source_district_id')
        passed=all(within(p,districts[district]) for p in outline)
        passed=passed and not any(inside(p,poly) and boundary(p,poly)>.025 for p in outline for poly in planned.values())
        passed=passed and not any(distance(p,a,b)<w/2-.025 for p in outline for a,b,w in roads)
        check(passed,name+': courtyard decoration overlaps buildings/roads or leaves its source district.')
        courtyard.append({'object':name,'districtId':district,'passed':passed})
    # Poses can have wider arms/props than the original figures. Check actual
    # triangles against other figures and the retained large market props.
    people=[o for o in actual.values() if o.get('asset_mount_role')=='citizen']
    obstacles=people+[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('asset_kind') in ('market_stall','cargo','hand_cart','well','statue')]
    geometry={};bounds3={}
    for obj in obstacles:
        verts=points(obj)
        geometry[obj.name]=BVHTree.FromPolygons(verts,[list(f.vertices) for f in obj.data.polygons])
        bounds3[obj.name]=([min(p[i] for p in verts) for i in range(3)],[max(p[i] for p in verts) for i in range(3)])
    citizen_conflicts=[];tested_pairs=set()
    for obj in people:
        lo,hi=bounds3[obj.name]
        for other in obstacles:
            if obj is other:continue
            pair=tuple(sorted((obj.name,other.name)))
            if pair in tested_pairs:continue
            tested_pairs.add(pair);ol,oh=bounds3[other.name]
            if any(hi[i]<ol[i] or oh[i]<lo[i] for i in range(3)):continue
            if geometry[obj.name].overlap(geometry[other.name]):citizen_conflicts.append(pair)
    check(not citizen_conflicts,'Authored citizens intersect other figures or market props: '+str(citizen_conflicts[:8]))
    shop_door_checks=[]
    door_objects=[o for o in actual.values() if o.get('asset_mount_role')=='house_entrance']
    for shop,poly in zip(manifest.get('shopfronts',{}).get('shop_positions',[]),manifest.get('shopfronts',{}).get('occupied_footprints',[])):
        conflicts=[]
        for obj in door_objects:
            p=obj.matrix_world.translation;q=(p.x,p.y)
            if inside(q,poly) or boundary(q,poly)<.65:conflicts.append(obj.name)
        passed=not conflicts;check(passed,shop['building_id']+': shop frontage covers an authored house entrance.')
        shop_door_checks.append({'buildingId':shop['building_id'],'blockedDoors':conflicts,'passed':passed})
    return {'enabled':True,'passed':not failures,'usedVariants':len(counts),'meshPlacements':len(actual),
            'specialBuildings':len(special_expected),'cathedralRoles':integration['cathedralRoles'],
            'checkedRoofMounts':len(roof_results),'checkedFacadeMounts':len(facade_results),'checkedVegetation':len(vegetation),'checkedGates':len(gate_results),
            'roofs':roof_results,'facades':facade_results,'vegetation':vegetation,'gates':gate_results,'courtyard':courtyard,
            'citizens':{'checked':len(people),'conflictingPairs':citizen_conflicts,'passed':not citizen_conflicts},
            'shopEntrances':shop_door_checks,
            'skippedMounts':integration['skippedMounts'],'failures':failures,
            'limits':'Facade checks sample vertices and face centers against neighbor height envelopes; gates sample pedestrian rays. These are geometric checks, not a complete collision or navigation solution.'}
