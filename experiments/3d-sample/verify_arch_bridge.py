"""Check saved stone arch meshes against source XY, walking heights and opening."""
import math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from bridge_geometry import profile, height_at, ARCH_THICKNESS, ROAD_Z


def verify_arch_bridge(selection, bridge, declared, objects, scale, tolerance, bed_z=-2.):
    path=[(p['x']*scale,p['y']*scale) for p in bridge['points']]
    road=next(r for r in selection['roads'] if r['id']==bridge['roadId'])
    width=road['width']*scale;outer=bridge['width']*scale
    design=profile(path);failures=[];cache={}
    def check(ok,message):
        if not ok:failures.append(bridge['id']+': '+message)
        return bool(ok)
    def geom(obj):
        if obj.name not in cache:
            verts=[obj.matrix_world@v.co for v in obj.data.vertices]
            obj.data.calc_loop_triangles()
            tree=BVHTree.FromPolygons(verts,[tuple(f.vertices) for f in obj.data.loop_triangles],all_triangles=True)
            cache[obj.name]=(verts,tree)
        return cache[obj.name]
    def samples(w):
        for a,b in zip(path,path[1:]):
            length=math.dist(a,b);n=(-(b[1]-a[1])/length,(b[0]-a[0])/length);count=max(4,math.ceil(length/.7))
            for i in range(count+1):
                # Probe just inside an open mesh boundary, within the existing
                # positional tolerance; exact endpoints are checked separately.
                t=max(tolerance/length*.5,min(1-tolerance/length*.5,i/count))
                for side in (-.49,-.25,0,.25,.49):
                    yield (a[0]+(b[0]-a[0])*t+n[0]*side*w,a[1]+(b[1]-a[1])*t+n[1]*side*w)
    def surface(members,w,offset):
        missing=[];error=0.;count=0
        for x,y in samples(w):
            count+=1;expected=height_at((x,y),path)+offset
            hits=[geom(o)[1].ray_cast(Vector((x,y,expected+.1)),Vector((0,0,-1)),.2)[0] for o in members]
            errors=[abs(h.z-expected) for h in hits if h is not None]
            if not errors or min(errors)>.015:missing.append((x,y))
            elif errors:error=max(error,min(errors))
        return {'passed':not missing,'sampleCount':count,'maxHeightError':error,'missing':missing[:8]}
    walkway=objects.get('Original_road_'+road['id'])
    mounted=[o for o in objects.values() if o.get('source_bridge_id')==bridge['id']]
    decks=[o for o in mounted if o.get('asset_mount_role')=='bridge_deck']
    rails=[o for o in mounted if o.get('asset_mount_role') in ('bridge_rail','bridge_rail_end')]
    abutments=[o for o in mounted if o.get('asset_mount_role')=='bridge_abutment']
    check(declared.get('profile',{}).get('style')=='stone-arch' and abs(declared.get('profile',{}).get('rise',0)-design['rise'])<tolerance,'declared arch profile differs from the source span.')
    check(walkway is not None and decks and len(rails)>=4 and len(abutments)==2,'required arch deck, parapets or dry-bank abutments are missing.')
    lane=surface([walkway] if walkway else [],width,0)
    deck=surface(decks,outer,-.008)
    check(lane['passed'],'actual bridge walking surface is detached, flat, narrowed or has holes.')
    check(deck['passed'],'actual stone arch deck does not follow the source span and profile.')
    endpoints=[]
    for vertex_id,p in zip((road['vertexIds'][0],road['vertexIds'][-1]),(path[0],path[-1])):
        nearby=[r for r in selection['roads'] if r['id']!=road['id'] and vertex_id in r.get('vertexIds',[])]
        neighbors=[objects['Original_road_'+r['id']] for r in nearby if 'Original_road_'+r['id'] in objects]
        if objects.get('Road_intersection_surfaces'):neighbors.append(objects['Road_intersection_surfaces'])
        connected=any((h:=geom(o)[1].ray_cast(Vector((*p,ROAD_Z+.05)),Vector((0,0,-1)),.1)[0]) is not None and abs(h.z-ROAD_Z)<tolerance for o in neighbors)
        seated=[]
        for obj in abutments:
            vv,tree=geom(obj);hit=tree.ray_cast(Vector((*p,ROAD_Z)),Vector((0,0,-1)),3)[0]
            if hit is not None and abs(hit.z-(ROAD_Z-ARCH_THICKNESS))<tolerance and min(v.z for v in vv)<=bed_z+tolerance:seated.append(obj.name)
        passed=check(connected and bool(seated),'bridge endpoint lacks its original bank connection or bed-founded bearing.')
        endpoints.append({'sourceVertexId':vertex_id,'passed':passed,'abutments':seated})
    # Check the actual full walking lane, at the rising deck height.
    lane_samples=list(samples(width));xybox=(min(p[0] for p in lane_samples),max(p[0] for p in lane_samples),min(p[1] for p in lane_samples),max(p[1] for p in lane_samples))
    blockers=[];opening_blockers=[]
    a,b=path[0],path[-1];length=math.dist(a,b);n=(-(b[1]-a[1])/length,(b[0]-a[0])/length)
    opening=[(a[0]+(b[0]-a[0])*t+n[0]*side*outer,a[1]+(b[1]-a[1])*t+n[1]*side*outer) for t in (.4,.45,.5,.55,.6) for side in (-.48,0,.48)]
    for obj in objects.values():
        if obj.type!='MESH':continue
        bb=[obj.matrix_world@Vector(p) for p in obj.bound_box]
        if max(p.x for p in bb)<xybox[0] or min(p.x for p in bb)>xybox[1] or max(p.y for p in bb)<xybox[2] or min(p.y for p in bb)>xybox[3]:continue
        if max(p.z for p in bb)<=-1.1 or min(p.z for p in bb)>design['rise']+ROAD_Z+2.1:continue
        vv,tree=geom(obj)
        if obj is not walkway and obj not in decks and any(tree.ray_cast(Vector((x,y,height_at((x,y),path)+.025)),Vector((0,0,1)),2.075)[0] is not None for x,y in lane_samples):blockers.append(obj.name)
        if any(tree.ray_cast(Vector((x,y,-1.1)),Vector((0,0,1)),2.15)[0] is not None for x,y in opening):opening_blockers.append(obj.name)
    check(not blockers,'an actual railing, wall or prop blocks the raised bridge walking clearance.')
    check(not opening_blockers,'the central arch opening has less than 2.2 units of clearance above water.')
    # The arch underside must be present above the clear waterway, not floating
    # decorations or an invisible flat road masquerading as a raised bridge.
    underside=all(any((h:=geom(o)[1].ray_cast(Vector((x,y,-1.1)),Vector((0,0,1)),10)[0]) is not None and abs(h.z-(height_at((x,y),path)-ARCH_THICKNESS))<.015 for o in decks) for x,y in opening)
    check(underside,'the load-bearing curved arch underside is missing or misplaced.')
    return {'id':bridge['id'],'roadId':road['id'],'style':'stone-arch','passed':not failures,
            'riseSceneUnits':design['rise'],'netWidthSceneUnits':width,'structuralWidthSceneUnits':outer,
            'walkingCoverage':lane,'stoneDeckCoverage':deck,'endpoints':endpoints,'blockers':blockers,
            'opening':{'passed':not opening_blockers and underside,'minimumClearance':2.2,'blockers':opening_blockers},
            'deckObjects':len(decks),'abutmentObjects':len(abutments),'railObjects':len(rails),'failures':failures}
