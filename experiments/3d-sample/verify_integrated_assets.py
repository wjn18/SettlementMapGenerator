"""Inspect saved authored placements independently of the assembly code."""
import bpy
import hashlib
import math
import re
from collections import Counter
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from spatial_index import BoxIndex


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
    box_index=BoxIndex(boxes.items())
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
    for extra in integration.get('additionalLibraries',[]):
        path=Path(extra['library'])
        check(path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest()==extra['sha256'],'Additional authored library hash changed: '+str(path))
        if extra.get('manifestSha256'):
            metadata=path.with_name('asset-library.json')
            check(metadata.is_file() and hashlib.sha256(metadata.read_bytes()).hexdigest()==extra['manifestSha256'],'Additional authored asset metadata changed: '+str(metadata))
    for name,obj in actual.items():
        row=listed.get(name,{})
        check(obj.get('authored_asset_id')==row.get('assetId'),name+': asset identity mismatch.')
        check(obj.get('source_building_id')==row.get('sourceBuildingId'),name+': source building identity mismatch.')
        check(obj.get('source_feature_id')==row.get('sourceFeatureId'),name+': source feature identity mismatch.')
        check(obj.get('source_market_id')==row.get('sourceMarketId'),name+': source market identity mismatch.')
    special_wards=('Cathedral','Farm','PatriciateWard','Castle') if integration.get('castleKitEnabled') else ('Cathedral','Farm','PatriciateWard')
    special_expected={b['id'] for b in selection['buildings'] if b.get('wardType') in special_wards}
    check({r['buildingId'] for r in integration['specialBuildings']}==special_expected,'Dedicated ward coverage differs from source buildings.')
    groups={}
    for r in integration['cathedralRoles']:groups.setdefault(r['districtId'],[]).append(r)
    for district,roles in groups.items():
        expected={b['id'] for b in selection['buildings'] if b['districtId']==district}
        check({r['buildingId'] for r in roles}==expected,district+': cathedral role assignment omits or adds a building.')
        check(sum(r['role']=='main_hall' for r in roles)==1,district+': expected exactly one main hall.')
        check(sum(r['role']=='bell_tower' for r in roles)==int(len(expected)>1),district+': tower must occupy one existing volume.')
        source_roles={b['id']:b.get('architecturalRole') for b in selection['buildings'] if b['districtId']==district}
        if any(source_roles.values()):
            check(all(r.get('sourceSemantic') and r['role']==source_roles[r['buildingId']] for r in roles),district+': explicit 2D church roles changed during assembly.')
            for b in selection['buildings']:
                if b['districtId']!=district:continue
                p=[(q['x'],q['y']) for q in b['points']]
                church_edges=[(c[0]-a[0],c[1]-a[1]) for a,c in zip(p,p[1:]+p[:1])]
                lengths=[math.hypot(*e) for e in church_edges]
                check(len(p)==4 and min(lengths)>=6-1e-4,b['id']+': regular church part must be rectangular and at least 6m wide.')
                check(all(abs(a[0]*c[0]+a[1]*c[1])<1e-6*math.hypot(*a)*math.hypot(*c) for a,c in zip(church_edges,church_edges[1:]+church_edges[:1])),b['id']+': church part has a non-orthogonal corner.')
                if b['architecturalRole']=='bell_tower':check(max(lengths)/min(lengths)<1.001,b['id']+': explicit bell tower must have a square footprint.')
    # Derive crests from the saved roof faces, independently of the mounting
    # algorithm and manifest. Footprint containment alone misses floating caps.
    crest_edges={};roof_geometry={}
    for obj in bpy.context.scene.objects:
        match=re.fullmatch(r'(.+)_roof_\d+_\d+',obj.name)
        if obj.type!='MESH' or not match:continue
        bid=match[1];verts=points(obj)
        roof_geometry.setdefault(bid,[]).append((verts,[list(f.vertices) for f in obj.data.polygons]))
        for face in obj.data.polygons:
            normal=obj.matrix_world.to_3x3().inverted().transposed()@face.normal
            if abs(normal.z)<1e-7:continue
            slope=Vector((-normal.x/normal.z,-normal.y/normal.z,0))
            ring=[verts[i] for i in face.vertices]
            for a,b in zip(ring,ring[1:]+ring[:1]):
                if abs(a.z-b.z)>1e-4 or (a-b).length<.1:continue
                key=tuple(sorted(tuple(round(x,4) for x in p) for p in (a,b)))
                crest_edges.setdefault(bid,{}).setdefault(key,[]).append((a,b,slope))
    crests={}
    for bid,edge_map in crest_edges.items():
        crests[bid]=[]
        for occurrences in edge_map.values():
            if len(occurrences)!=2:continue
            a,b,slope=occurrences[0];along=(b-a).normalized();cross=Vector((-along.y,along.x,0))
            if slope.dot(cross)*occurrences[1][2].dot(cross)<-1e-8:
                crests[bid].append((a,b,along,cross))
    roof_trees={}
    for bid,parts in roof_geometry.items():
        verts=[];faces=[]
        for vv,ff in parts:
            offset=len(verts);verts.extend(vv);faces.extend([[i+offset for i in f] for f in ff])
        roof_trees[bid]=BVHTree.FromPolygons(verts,faces)
    roof_results=[];ridge_results=[];facade_results=[];castle_results=[]
    facade_roles={'special_facade','patriciate_cornice','timber_panel','house_window','house_entrance','cathedral_window','cathedral_entrance','castle_window','castle_entrance','castle_masonry_detail','harbor_warehouse_door','harbor_warehouse_hoist'}
    for name,obj in actual.items():
        row=listed.get(name,{});role=row.get('role');bid=row.get('sourceBuildingId')
        if role in ('footprint_fitted_roof','ridge_detail','dormer','bell_tower_upper','castle_keep_roof','castle_keep_turret','castle_keep_parapet'):
            verts=points(obj);bad=[p for p in verts if not within((p.x,p.y),planned[bid])]
            passed=not bad;check(passed,name+': roof or upper tower leaves its original footprint.')
            roof_results.append({'object':name,'buildingId':bid,'role':role,'outsideVertices':len(bad),'passed':passed})
        if role=='ridge_detail':
            unsupported=[];distances=[]
            for p in points(obj):
                supported=False
                for a,b,along,cross in crests.get(bid,[]):
                    delta=p-a;t=delta.dot(along)
                    if -.0005<=t<=(b-a).length+.0005 and abs(delta.dot(cross))<=.19 and -.13<=delta.z<=.281:
                        supported=True;break
                if not supported:unsupported.append(p)
                hit=roof_trees[bid].find_nearest(p) if bid in roof_trees else None
                distances.append(hit[3] if hit and hit[0] is not None else float('inf'))
            maximum=max(distances,default=0)
            passed=not unsupported and maximum<=.4
            check(passed,name+': ridge extends beyond a real roof crest or floats above the roof.')
            ridge_results.append({'object':name,'buildingId':bid,'unsupportedVertices':len(unsupported),
                                  'maxDistanceToRoof':round(maximum,5),'passed':passed})
        if role in facade_roles:
            verts=points(obj);obbox=bbox([(p.x,p.y) for p in verts]);near=[other for other in box_index.query(obbox) if other!=bid]
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
    if integration.get('castleKitEnabled'):
        castle_ids={b['id'] for b in selection['buildings'] if b.get('wardType')=='Castle'}
        roles=integration['castleRoles']
        check({r['buildingId'] for r in roles}==castle_ids,'Castle role assignment differs from the source buildings.')
        for district in {r['districtId'] for r in roles}:
            group=[r for r in roles if r['districtId']==district]
            check(sum(r['role']=='keep' for r in group)==1,district+': expected exactly one keep.')
        forbidden={'timber_panel','house_window','house_entrance','ridge_detail','dormer','shop_goods','shop_sign'}
        for bid in castle_ids:
            objects=[o for o in actual.values() if o.get('source_building_id')==bid]
            shells=[o for o in objects if o.get('asset_mount_role')=='castle_keep_shell']
            roofs=[o for o in objects if o.get('asset_mount_role')=='castle_keep_roof']
            towers=[o for o in objects if o.get('asset_mount_role')=='castle_keep_turret']
            entrances=[o for o in objects if o.get('asset_mount_role')=='castle_entrance']
            bad=[o.name for o in objects if o.get('asset_mount_role') in forbidden]
            check(not bad,bid+': generic house or shop components remain on the castle.')
            check(len(shells)==len(roofs)==1,bid+': keep must have exactly one adapted stone core and inset roof.')
            check(len(entrances)==1,bid+': keep must have one authored entrance.')
            if not shells or not roofs:continue
            eave=max(p.z for p in points(shells[0]));main=records[bid]['architecturalRole']=='keep'
            check(not main or eave>=17.79,bid+': main keep does not rise above the curtain wall.')
            check(all(m.get('semantic_slot')=='stone' for m in shells[0].data.materials),bid+': castle core is not stone.')
            check(abs(min(p.z for p in points(roofs[0]))-eave)<.08,bid+': inset roof does not rest on the stone platform.')
            for tower in towers:check(abs(min(p.z for p in points(tower))-eave)<.08,tower.name+': turret is not supported by the platform.')
            roof=roofs[0];roof_tree=BVHTree.FromPolygons(points(roof),[list(f.vertices) for f in roof.data.polygons])
            collisions=[]
            for tower in towers:
                tree=BVHTree.FromPolygons(points(tower),[list(f.vertices) for f in tower.data.polygons])
                if roof_tree.overlap(tree):collisions.append(tower.name)
            check(not collisions,bid+': inset roof intersects a corner turret.')
            native=[o.name for o in bpy.context.scene.objects if o.name.startswith(bid+'_') and ('chimney' in o.name or 'dormer' in o.name or re.fullmatch(re.escape(bid)+r'_roof_\d+_\d+',o.name))]
            check(not native,bid+': generic native roof, dormer or chimney remains on the stone keep.')
            castle_results.append({'buildingId':bid,'role':records[bid]['architecturalRole'],'eaveHeight':round(eave,4),
                                   'turrets':len(towers),'entrances':len(entrances),'roofTurretConflicts':collisions,
                                   'genericComponents':bad+native,'passed':not collisions and not bad and not native and len(entrances)==1})
    vegetation=[]
    features={f['id']:xy(f['points']) for f in selection.get('features',[])}
    roads=[(a,b,r['width']*scale) for r in selection['roads'] for poly in [xy(r['points'])] for a,b in zip(poly,poly[1:])]
    road_index=BoxIndex((i,(min(a[0],b[0])-w/2,max(a[0],b[0])+w/2,min(a[1],b[1])-w/2,max(a[1],b[1])+w/2)) for i,(a,b,w) in enumerate(roads))
    for name,obj in actual.items():
        if listed.get(name,{}).get('role') not in ('grove_tree','grove_shrub'):continue
        fid=obj.get('source_feature_id');verts=points(obj);outline=[(p.x,p.y) for p in verts];box=bbox(outline)
        near=box_index.query(box)
        outside=sum(not within(p,features[fid]) for p in outline)
        conflicts=[bid for bid in near if any(inside(p,planned[bid]) and boundary(p,planned[bid])>.025 for p in outline)]
        nearby_roads=[roads[i] for i in road_index.query(box)]
        road_conflicts=any(distance(p,a,b)<w/2-.025 for p in set(outline) for a,b,w in nearby_roads)
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
        box=bbox(outline);nearby_buildings=[planned[bid] for bid in box_index.query(box)];nearby_roads=[roads[i] for i in road_index.query(box)]
        passed=all(within(p,districts[district]) for p in outline)
        passed=passed and not any(inside(p,poly) and boundary(p,poly)>.025 for p in set(outline) for poly in nearby_buildings)
        passed=passed and not any(distance(p,a,b)<w/2-.025 for p in set(outline) for a,b,w in nearby_roads)
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
    door_objects=[o for o in actual.values() if o.get('asset_mount_role') in ('house_entrance','castle_entrance')]
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
            'roofs':roof_results,'ridges':ridge_results,'checkedRidges':len(ridge_results),
            'castles':castle_results,
            'facades':facade_results,'vegetation':vegetation,'gates':gate_results,'courtyard':courtyard,
            'citizens':{'checked':len(people),'conflictingPairs':citizen_conflicts,'passed':not citizen_conflicts},
            'shopEntrances':shop_door_checks,
            'skippedMounts':integration['skippedMounts'],'failures':failures,
            'limits':'Facade checks sample vertices and face centers against neighbor height envelopes; gates sample pedestrian rays. These are geometric checks, not a complete collision or navigation solution.'}
