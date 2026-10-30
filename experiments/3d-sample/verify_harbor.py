"""Independently inspect the saved coastal scene's actual world-space meshes."""
import math, json
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from harbor_geometry import xy, inside, segment_distance, overlaps, rectangle, ring_samples, area, hull_ring, compare_sea_boundary


def verify_harbor(selection, manifest, scale):
    coast=selection.get('terrain',{}).get('coast');data=manifest.get('harbor',{})
    river_ports=[d for d in selection.get('terrain',{}).get('docks',[]) if d.get('waterbody')=='river']
    if not coast and not river_ports:return {'enabled':False,'passed':not data.get('enabled'),'failures':[] if not data.get('enabled') else ['Harbor added to an inland plan.']}
    failures=[];checks=[];objects={o.name:o for o in bpy.context.scene.objects};tol=1e-4
    def check(value,message):
        if not value:failures.append(message)
        return bool(value)
    def verts(o):return [o.matrix_world@v.co for v in o.data.vertices]
    def scaled(raw):return [(x*scale,y*scale) for x,y in xy(raw)]
    def boundary(p,ring):return min(segment_distance(p,a,b) for a,b in zip(ring,ring[1:]+ring[:1]))
    check(data.get('enabled'),'Coastal planning data has no harbor representation.')
    level=-1.15;surface=None;water=[]
    if coast:
        water=scaled(coast['water']);surface=objects.get('Harbor_sea_surface');level=-1.15
        if check(surface is not None,'The planned sea surface is missing.'):
            v=verts(surface);actual=[(p.x,p.y) for p in v]
            comparison=compare_sea_boundary(water,actual,tol*scale)
            level_passed=all(abs(p.z-level)<tol for p in v)
            passed=comparison['passed'] and level_passed
            check(passed,'The actual sea boundary or water level differs from the source coast.')
            checks.append({'kind':'sea',**comparison,'passed':passed,'waterLevelPassed':level_passed})
        estuary=bool(selection.get('river'))
        ground_names=(manifest.get('estuary',{}).get('landObjects',[])+manifest.get('estuary',{}).get('bankObjects',[])) if estuary else ['Study_ground']
        grounds=[objects[name] for name in ground_names if name in objects]
        if check(bool(grounds) and len(grounds)==len(ground_names),'The dry-land slab is missing.'):
            # Test evaluated triangulation, not just outline vertices: an intact
            # rectangular slab under the water must fail this check.
            triangles=[];bad=[]
            for ground in grounds:
                ground.data.calc_loop_triangles();v=verts(ground)
                top=[t for t in ground.data.loop_triangles if all(abs(v[i].z)<tol for i in t.vertices)]
                triangles.extend(top)
                for t in top:
                    p=tuple(sum(v[i][axis] for i in t.vertices)/3 for axis in (0,1))
                    if inside(p,water) and boundary(p,water)>tol:bad.append(p)
            check(bool(triangles) and not bad,'Dry land overlaps the planned sea.')
            checks.append({'kind':'land_sea_separation','passed':bool(triangles) and not bad,'topTriangles':len(triangles),'overlappingTriangles':len(bad)})
    expected={d['id']:d for d in selection['terrain']['docks']}
    listed={d['id']:d for d in data.get('docks',[])}
    check(set(expected)==set(listed),'Harbor manifest dock IDs differ from the source plan.')
    base_objects=[o for o in objects.values() if o.get('asset_kind')=='exact_dock_base']
    check({o.get('source_dock_id') for o in base_objects}==set(expected),'Actual dock IDs differ from source dock IDs.')
    dock_rings=[]
    for did,dock in expected.items():
        points=scaled(dock['points']);width=dock['width']*scale
        dock_parts=[o for o in base_objects if o.get('source_dock_id')==did]
        check(len(dock_parts)==len(points)-1,did+': segment count differs from the source path.')
        for i,(a,b) in enumerate(zip(points,points[1:])):
            ring=rectangle(a,b,width);dock_rings.append(ring)
            obj=objects.get('Harbor_dock_'+did+'_'+str(i));passed=False
            if obj:
                v=verts(obj);actual=[(p.x,p.y) for p in v if abs(p.z+.20)<tol]
                passed=len(actual)==4 and max(min(math.dist(p,q) for q in ring) for p in actual)<tol*scale and all(abs(p.z+.20)<tol or abs(p.z+.16)<tol for p in v)
            check(passed,did+': actual base centerline, width or height differs from the source dock.')
            checks.append({'kind':'dock','id':did,'segment':i,'passed':passed,'widthPlanUnits':dock['width']})
        # Assert real deck boards exist, rather than accepting an empty base.
        deck=[o for o in objects.values() if o.get('source_dock_id')==did and o.get('asset_mount_role')=='harbor_deck']
        check(bool(deck),did+': authored timber deck is missing.')
        for o in deck:
            p=verts(o);check(abs(max(q.z for q in p)-.037)<tol,did+': timber deck top does not match the road datum and its rendering offset.')
            check(o.matrix_world.to_3x3().determinant()>0,did+': reflected dock transform flips its surface orientation.')
    quay_objects=[o for o in objects.values() if o.get('asset_mount_role') in ('harbor_quay','harbor_quay_underpass') and o.get('source_waterbody')!='river']
    shore=scaled(coast['shoreline']) if coast else [];quay_segments=set()
    for o in quay_objects:
        i=o.get('source_shore_segment');ok=isinstance(i,int) and 0<=i<len(shore)-1
        if ok:
            p=o.matrix_world.translation;ok=segment_distance((p.x,p.y),shore[i],shore[i+1])<tol*scale;quay_segments.add(i)
        check(ok,o.name+': quay is detached from the source shoreline.')
    check(quay_segments=={q['shoreSegment'] for q in data.get('quaySegments',[])},'Actual quay segments differ from their manifest.')
    qvertices=[];qfaces=[]
    for o in quay_objects:
        offset=len(qvertices);qvertices.extend(verts(o));qfaces.extend(tuple(offset+i for i in f.vertices) for f in o.data.polygons)
    quay_tree=BVHTree.FromPolygons(qvertices,qfaces) if qfaces else None
    walkway_results=[]
    for did,dock in expected.items():
        if dock.get('waterbody')=='river':continue
        dp=scaled(dock['points']);width=dock['width']*scale;crossings=[]
        for a,b in zip(dp,dp[1:]):
            dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy);u=(dx/length,dy/length);n=(-u[1],u[0])
            for c,d in zip(shore,shore[1:]):
                ex,ey=d[0]-c[0],d[1]-c[1];det=dx*ey-dy*ex
                if abs(det)<1e-9:continue
                t=((c[0]-a[0])*ey-(c[1]-a[1])*ex)/det;s=((c[0]-a[0])*dy-(c[1]-a[1])*dx)/det
                if not(0<=t<=1 and 0<=s<=1):continue
                p=(a[0]+t*dx,a[1]+t*dy);blockers=[]
                for forward in (-.4,0,.4):
                    for lateral in (-.48,-.25,0,.25,.48):
                        q=(p[0]+u[0]*forward+n[0]*lateral*width,p[1]+u[1]*forward+n[1]*lateral*width)
                        hit=quay_tree.ray_cast(Vector((*q,.025)),Vector((0,0,1)),2)[0] if quay_tree else None
                        if hit is not None:blockers.append(tuple(hit))
                crossings.append({'point':p,'passed':not blockers,'blockingQuayHits':blockers})
        passed=bool(crossings) and all(c['passed'] for c in crossings)
        check(passed,did+': retaining-wall coping obstructs the dock walking surface.')
        walkway_results.append({'dockId':did,'passed':passed,'crossings':crossings})
    hulls=[];boats=[]
    actual_boats={o.name:o for o in objects.values() if o.get('asset_mount_role')=='harbor_boat'}
    listed_boats={b['object']:b for b in data.get('boats',[])}
    check(set(actual_boats)==set(listed_boats),'Actual boat instances differ from the harbor manifest.')
    # Preserve the surrounding sea, rather than accepting a globally hidden
    # or deleted water surface as a dry-cabin fix.
    if surface:
        surface.data.calc_loop_triangles();sea_vertices=verts(surface)
        actual_area=sum(area([(sea_vertices[i].x,sea_vertices[i].y) for i in t.vertices]) for t in surface.data.loop_triangles)
        excluded_area=0
        for obj in actual_boats.values():
            if obj.get('source_waterbody')=='river':continue
            profile=json.loads(obj.get('hull_profile','{}'))
            if not profile:continue
            ring=[obj.matrix_world@Vector((x,y,0)) for x,y in hull_ring(profile)]
            excluded_area+=area([(p.x,p.y) for p in ring])
        # The saved boundary uses Blender float32 coordinates, already checked
        # against the source above. Compare area in that same representation
        # so a large sea does not spend the tolerance on initial mesh rounding.
        saved_outer_area=area([(p.x,p.y) for p in sea_vertices[:len(water)]])
        expected_area=saved_outer_area-excluded_area
        area_tolerance=max(.001,saved_outer_area*1e-7)
        coverage=abs(actual_area-expected_area)<=area_tolerance
        check(coverage,'Sea coverage changed beyond the vessel waterline exclusions.')
        checks.append({'kind':'sea_coverage','passed':coverage,'actualAreaSceneUnits2':actual_area,'expectedAreaSceneUnits2':expected_area,'areaToleranceSceneUnits2':area_tolerance,'excludedHullAreaSceneUnits2':excluded_area})
    water_trees=[]
    water_names={'Harbor_sea_surface','Harbor_shallow_water','Harbor_broken_ripples'}
    water_names.update(o.name for o in objects.values() if o.type=='MESH' and
                       (o.get('terrain_water_layer') or o.get('water_level') is not None or o.get('source_terrain_role') in ('sea','river_water','river_ripples','river_shallow')))
    for name in sorted(water_names):
        obj=objects.get(name)
        if obj and obj.data.polygons:water_trees.append((name,BVHTree.FromPolygons(verts(obj),[tuple(f.vertices) for f in obj.data.polygons])))
    for name,o in actual_boats.items():
        v=verts(o);row=listed_boats[name]
        # Derive the conservative footprint from the stored mesh's own local
        # bounds. This includes oars, sailcloth and rigging as well as the hull.
        lo=[min(p.co[i] for p in o.data.vertices) for i in (0,1)];hi=[max(p.co[i] for p in o.data.vertices) for i in (0,1)]
        pp=[o.matrix_world@Vector((x,y,0)) for x,y in ((lo[0],lo[1]),(hi[0],lo[1]),(hi[0],hi[1]),(lo[0],hi[1]))];ring=[(p.x,p.y) for p in pp]
        vessel_water=scaled(selection['river']['surface']) if o.get('source_waterbody')=='river' else water
        wet=all(inside(q,vessel_water) for q in ring_samples(ring))
        collision=any(overlaps(ring,q,.30) for q in dock_rings+hulls)
        waterline=abs(o.matrix_world.translation.z-level)<tol and min(p.z for p in v)<level<max(p.z for p in v)
        # Probe actual saved triangles in every open cabin. Checking the boat's
        # origin/waterline alone cannot detect an uncut sea filling its interior.
        profile=json.loads(o.get('hull_profile','{}'));flooded=[];missing_floor=[];probes=0
        if profile:
            boat_tree=BVHTree.FromPolygons(v,[tuple(f.vertices) for f in o.data.polygons])
            for fx in (-.30,-.15,0,.15,.30):
                for fy in (-.15,0,.15):
                    p=o.matrix_world@Vector((fx*profile['length'],fy*profile['width'],0));probes+=1
                    for water_name,tree in water_trees:
                        hit=tree.ray_cast(Vector((p.x,p.y,level+.05)),Vector((0,0,-1)),.10)[0]
                        if hit is not None:flooded.append({'waterObject':water_name,'point':tuple(hit)})
                    if boat_tree.ray_cast(Vector((p.x,p.y,level+.001)),Vector((0,0,-1)),3)[0] is None:missing_floor.append((p.x,p.y))
        dry=bool(probes) and not flooded and not missing_floor
        check(dry,name+': water enters the cabin or its continuous wooden floor is missing.')
        passed=wet and not collision and waterline and row['dockId'] in expected and dry
        check(passed,name+': vessel is ashore, overlaps a dock/boat or has an incorrect waterline.')
        hulls.append(ring);boats.append({'object':name,'assetId':o.get('authored_asset_id'),'passed':passed,'insideWater':wet,'waterbody':o.get('source_waterbody','coast'),'insideSea':wet and o.get('source_waterbody')!='river','collisionFree':not collision,'waterlinePassed':waterline,'dryInteriorPassed':dry,'interiorProbes':probes,'waterIntersections':flooded,'missingFloorProbes':missing_floor})
    harbor_buildings={b['id'] for b in selection['buildings'] if b.get('wardType')=='Harbor'}
    warehouse_objects=[o for o in objects.values() if o.get('asset_mount_role') in ('harbor_warehouse_door','harbor_warehouse_hoist')]
    check(all(o.get('source_building_id') in harbor_buildings for o in warehouse_objects),'Warehouse kit attached to a non-harbor building.')
    records={r['id']:r for r in manifest['buildings']}
    for o in warehouse_objects:
        bid=o.get('source_building_id');record=records.get(bid)
        if not record:continue
        p=o.matrix_world.translation
        check(boundary((p.x,p.y),record['footprint'])<tol,o.name+': warehouse component is detached from its source facade.')
        check(max(v.z for v in verts(o))<=record['eave']+.01,o.name+': warehouse component projects above its facade eave.')
    from verify_river_harbor import verify_river_harbor
    river_report=verify_river_harbor(selection,manifest,scale)
    failures.extend(river_report['failures']);checks.extend(river_report['checks'])
    return {'enabled':True,'version':2,'riverHarbor':river_report,'passed':not failures,'waterLevel':level,'verifiedDocks':len(expected),'quaySegments':len(quay_segments),'dockWalkways':walkway_results,'warehouseComponents':len(warehouse_objects),'boatVariants':sorted({b['assetId'] for b in boats}),'boats':boats,'checks':checks,'failures':failures,'limits':'Static coastal water and decorative berths; combined rivers and bridges receive additional independent checks. Tides and navigation simulation are outside this adapter.'}
