"""Assemble a coastal city from unchanged sea, shore and dock planning data."""
import bpy, json, math, hashlib
from pathlib import Path
from mathutils import Matrix, Vector
from harbor_geometry import xy, land_ring, inside, ring_samples, overlaps, rectangle, segment_distance,segment_in_rectangle
from props import boundary_distance

LIBRARY=Path(__file__).resolve().parents[2]/'artifacts'/'harbor-assets'/'harbor-asset-library.blend'
WATER_Z=-1.15
DECK_TOP_Z=.037  # 2 mm above the road shading plane; avoids coplanar flicker.
STRUCTURAL={'harbor_quay','harbor_quay_underpass','harbor_quay_corner','harbor_steps','harbor_deck','harbor_piles','harbor_bollard','harbor_boat'}


def build_harbor(source, records, api, lib, scale, terrain_plan=None):
    coast=source.get('terrain',{}).get('coast')
    from river_harbor_geometry import river_docks
    if not coast and not river_docks(source):return {'enabled':False}
    if coast and source.get('river') and terrain_plan is None:
        from estuary_geometry import plan_estuary
        terrain_plan=plan_estuary(source,scale)
    if lib is None:raise ValueError('Coastal scenes require the authored harbor and small-town libraries.')
    path=LIBRARY;manifest_path=path.with_name('asset-library.json')
    if not path.is_file():raise FileNotFoundError('Build build_harbor_assets.py before generating a coastal city.')
    manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    if manifest['materialSlots']!=lib.slots:raise ValueError('Harbor material slots must match the town library.')
    entries={e['id']:e for e in manifest['assets']}
    with bpy.data.libraries.load(str(path),link=False) as (available,target):
        if set(entries)-set(available.collections):raise ValueError('Harbor library collections are incomplete.')
        target.collections=list(entries)
    lib.entries.update(entries);lib.collections.update({c.name:c for c in target.collections})
    lib.additional_libraries.append({'library':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'manifestSha256':hashlib.sha256(manifest_path.read_bytes()).hexdigest(),'kitId':'harbor_kit'})
    mesh=api['mesh'];extrude=api['extrude'];coll=api['collection']('08_HARBOR')
    def pts(raw):return [(p[0]*scale,p[1]*scale) for p in xy(raw)]
    def place(aid,p=(0,0,0),s=(1,1,1),basis=None,role='decoration',bid=None):
        obj=lib.place(aid,p,scale=s,basis=basis,collection=coll,role=role,building_id=bid)
        if obj and role in STRUCTURAL:obj['ink_structural']=True;obj.pass_index=0
        return obj
    if coast:
        water_source=next(o for o in lib.collections['harbor_sea_01'].objects if o.type=='MESH')
        water_material=water_source.data.materials[lib.slots.index('water')]
        shallow_material=water_source.data.materials[lib.slots.index('water_light')]
        water=pts(coast['water']);shore=pts(coast['shoreline'])
        if terrain_plan is None:
            land=land_ring(coast,source['cropPolygon']);land=[(p[0]*scale,p[1]*scale) for p in land]
            # A combined estuary already owns the joint land partition.
            old=bpy.data.objects.get('Study_ground')
            if old:bpy.data.objects.remove(old,do_unlink=True)
            ground=extrude('Study_ground',land,-2.0,0,api['M']['ground'],'00_GROUND');ground['environment_extent']=True
        surface=mesh('Harbor_sea_surface',[(x,y,WATER_Z) for x,y in water],[tuple(range(len(water)))],water_material,'08_HARBOR')
        surface['environment_extent']=True;surface['water_level']=WATER_Z;surface['source_terrain_role']='sea'
        surface['terrain_water_layer']=True;surface['water_body']='sea';surface['water_layer']='surface'
        surface['authored_asset_id']='harbor_sea_01';surface['asset_mount_role']='harbor_sea';surface['representation']='authored_3d_kit'
        lib.register(surface,'harbor_sea_01','harbor_sea')
        # One material and one water datum across the exact shared mouth boundary.
        for name,mat in (('River_water_surface',water_material),('River_flow_strokes',shallow_material)):
            existing=bpy.data.objects.get(name)
            if existing:existing.data.materials.clear();existing.data.materials.append(mat)
        def water_normal(a,b):
            length=math.dist(a,b);n=(-(b[1]-a[1])/length,(b[0]-a[0])/length)
            mid=((a[0]+b[0])/2,(a[1]+b[1])/2)
            return n if inside((mid[0]+n[0]*.3,mid[1]+n[1]*.3),water) else (-n[0],-n[1])
        roads={r['id']:r for r in source['roads']}
        waterfront=[pts(roads[w['roadId']]['points']) for w in source['terrain']['waterfronts'] if w['kind']=='coast']
        # Restrict stone engineering to the developed waterfront, leaving open coast natural.
        quay=[];quay_openings=[];shallow_v=[];shallow_f=[]
        dry_intervals={}
        if terrain_plan:
            for part in terrain_plan['coastDrySegments']:
                dry_intervals.setdefault(part['sourceSegment'],[]).append((part['start'],part['end']))
        for i,(a,b) in enumerate(zip(shore,shore[1:])):
            n=water_normal(a,b);mid=tuple((a[k]+b[k])/2 for k in (0,1));length=math.dist(a,b)
            dry=dry_intervals.get(i,[]) if terrain_plan else [(0.,1.)]
            if not dry:continue
            for lo,hi in dry:
                c=tuple(a[k]+(b[k]-a[k])*lo for k in (0,1));d=tuple(a[k]+(b[k]-a[k])*hi for k in (0,1))
                index=len(shallow_v)
                shallow_v.extend([(c[0],c[1],WATER_Z+.005),(d[0],d[1],WATER_Z+.005),(d[0]+n[0]*2,d[1]+n[1]*2,WATER_Z+.005),(c[0]+n[0]*2,c[1]+n[1]*2,WATER_Z+.005)])
                shallow_f.append(tuple(index+j for j in range(4)))
            developed=any(segment_distance(mid,c,d)<10 for rp in waterfront for c,d in zip(rp,rp[1:]))
            if not developed:continue
            tangent=((b[0]-a[0])/length,(b[1]-a[1])/length)
            basis=Matrix(((tangent[0],-n[0],0,0),(tangent[1],-n[1],0,0),(0,0,1,0),(0,0,0,1)))
            openings=[]
            for dock in source['terrain']['docks']:
                dp=pts(dock['points'])
                for c,d in zip(dp,dp[1:]):
                    interval=segment_in_rectangle(a,b,c,d,dock['width']*scale+.80)
                    if interval:openings.append((*interval,dock['id']))
            cuts=sorted({0.,1.,*(t for lo,hi,_ in openings for t in (lo,hi)),*(t for lo,hi in dry for t in (lo,hi))});count=0
            for lo,hi in zip(cuts,cuts[1:]):
                if not any(start-1e-9<=(lo+hi)/2<=end+1e-9 for start,end in dry):continue
                ids=[did for start,end,did in openings if start-1e-8<=(lo+hi)/2<=end+1e-8]
                run=length*(hi-lo);modules=max(1,math.ceil(run/4));count+=modules
                for j in range(modules):
                    t=lo+(hi-lo)*(j+.5)/modules
                    # Keep the retaining foundation, but lower the coping under
                    # the wooden walkway. Deck top stays at the road datum .035.
                    zscale=(1.75-.22)/(1.75+.11) if ids else 1
                    z=-1.75+1.75*zscale if ids else 0
                    p=(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,z)
                    role='harbor_quay_underpass' if ids else 'harbor_quay'
                    o=place('harbor_quay_01',p,(run/modules/4,1,zscale),basis,role);o['source_shore_segment']=i
                    if ids:o['dock_passage_ids']=','.join(ids)
                if ids:quay_openings.append({'shoreSegment':i,'start':lo,'end':hi,'dockIds':ids,'retainingTopZ':-.22,'deckTopZ':DECK_TOP_Z})
            quay.append({'shoreSegment':i,'start':a,'end':b,'modules':count})
        shallow=mesh('Harbor_shallow_water',shallow_v,shallow_f,shallow_material,'08_HARBOR');shallow['environment_extent']=True
        shallow['source_terrain_role']='sea_shallow';shallow['terrain_water_layer']=True;shallow['water_body']='sea';shallow['water_layer']='shallow'
        # Bounded, sparse strokes; they stay inside the planned sea.
        if waterfront:
            v=[];f=[]
            allp=[p for rp in waterfront for p in rp]
            rng=api['rng_for'](str(source.get('seed'))+'/harbor-ripples')
            for _ in range(160):
                x=rng.uniform(min(p[0] for p in allp)-20,max(p[0] for p in allp)+40)
                y=rng.uniform(min(p[1] for p in allp)-20,max(p[1] for p in allp)+20)
                a=(x,y);b=(x+rng.uniform(1.2,3.0),y+.12)
                if not all(inside(p,water) for p in (a,b)):continue
                k=len(v);v.extend([(a[0],a[1],WATER_Z+.012),(b[0],b[1],WATER_Z+.012),(b[0],b[1]+.035,WATER_Z+.012),(a[0],a[1]+.035,WATER_Z+.012)]);f.append((k,k+1,k+2,k+3))
            o=mesh('Harbor_broken_ripples',v,f,shallow_material,'08_HARBOR');o['environment_extent']=True
            o['source_terrain_role']='sea_ripples';o['terrain_water_layer']=True;o['water_body']='sea';o['water_layer']='ripples'
    else:
        water=pts(source['river']['surface']);shore=[];surface=None
        quay=[];quay_openings=[];waterfront=[]
    roads={r['id']:r for r in source['roads']}
    river_port_roads={d['roadId'] for d in river_docks(source)}
    waterfront += [pts(roads[w['roadId']]['points']) for w in source['terrain']['waterfronts'] if w['kind']=='river' and w['roadId'] in river_port_roads]
    from river_harbor_integration import build_river_quays, place_river_boats
    river_quays=build_river_quays(source,api,place,scale)
    docks=[];dock_obstacles=[]
    for dock in source['terrain']['docks']:
        p=pts(dock['points']);width=dock['width']*scale
        pieces=[]
        for seg,(a,b) in enumerate(zip(p,p[1:])):
            length=math.dist(a,b)
            if length<1e-7:continue
            u=((b[0]-a[0])/length,(b[1]-a[1])/length);cross=(u[1],-u[0])
            basis=Matrix(((cross[0],u[0],0,0),(cross[1],u[1],0,0),(0,0,1,0),(0,0,0,1)))
            ring=rectangle(a,b,width);dock_obstacles.append(ring)
            base=extrude('Harbor_dock_'+dock['id']+'_'+str(seg),ring,-.20,-.16,api['M']['timber'],'08_HARBOR');base['source_dock_id']=dock['id'];base['source_dock_segment']=seg;base['asset_kind']='exact_dock_base';base['source_waterbody']=dock.get('waterbody','coast')
            count=max(1,math.ceil(length/2))
            for j in range(count):
                t=(j+.5)/count;o=place('harbor_dock_deck_01',(a[0]+u[0]*length*t,a[1]+u[1]*length*t,DECK_TOP_Z),(width/3,length/count/2,1),basis,'harbor_deck');o['source_dock_id']=dock['id']
            for j in range(max(1,math.ceil(length/4))+1):
                t=j/max(1,math.ceil(length/4));pile_scale=1.;pile_z=DECK_TOP_Z
                if dock.get('waterbody')=='river':
                    from river_geometry import river_bed_level
                    limits=entries['harbor_dock_piles_01']['bounds'];low,high=limits['min'][2],limits['max'][2]
                    pile_scale=(DECK_TOP_Z+high-river_bed_level(source)+.15)/(high-low)
                    pile_z=DECK_TOP_Z+high-high*pile_scale
                o=place('harbor_dock_piles_01',(a[0]+u[0]*length*t,a[1]+u[1]*length*t,pile_z),(width/3,1,pile_scale),basis,'harbor_piles');o['source_dock_id']=dock['id']
            for t in (.42,.85):
                for sign in (-1,1):
                    river_port=dock.get('waterbody')=='river'
                    if river_port and seg==0:continue
                    offset=width/2+.04 if river_port else width/2-.30
                    pos=(a[0]+u[0]*length*t+cross[0]*sign*offset,a[1]+u[1]*length*t+cross[1]*sign*offset,DECK_TOP_Z)
                    if river_port and not inside(pos[:2],pts(source['river']['surface'])):continue
                    o=place('harbor_bollard_01',pos,s=(.6,.6,.6) if river_port else (1,1,1),basis=basis if river_port else None,role='harbor_bollard');o['source_dock_id']=dock['id']
            pieces.append(base.name)
        docks.append({'id':dock['id'],'districtId':dock['districtId'],'roadId':dock['roadId'],'baseObjects':pieces})
    # Pick dock-facing facades, then use the existing precise mounting clearance.
    warehouses=[];skipped=[]
    for record in records:
        if record['wardType']!='Harbor':continue
        bid=record['id'];poly=record['footprint'];c=api['center'](poly);candidates=[]
        for a,b in zip(poly,poly[1:]+poly[:1]):
            length=math.dist(a,b)
            if length<4.2:continue
            u=((b[0]-a[0])/length,(b[1]-a[1])/length);n=(u[1],-u[0])
            mid=((a[0]+b[0])/2,(a[1]+b[1])/2)
            if inside((mid[0]+n[0]*.1,mid[1]+n[1]*.1),poly):n=(-n[0],-n[1])
            nearest=min((math.dist(mid,q) for rp in waterfront for q in rp),default=0)
            candidates.append((nearest,mid,u,n))
        mounted=[]
        for _,mid,u,n in sorted(candidates):
            basis=Matrix(((u[0],-n[0],0,0),(u[1],-n[1],0,0),(0,0,1,0),(0,0,0,1)))
            for aid,role in (('harbor_warehouse_door_01','harbor_warehouse_door'),('harbor_warehouse_hoist_01','harbor_warehouse_hoist')):
                height=max(v.co.z for v in lib.part(aid).vertices)
                sz=min(1,(record['eave']-.20)/height)
                source_mesh=lib.part(aid);matrix=Matrix.Translation(Vector((*mid,.08)))@basis@Matrix.Diagonal((1,1,sz,1))
                points=[matrix@v.co for v in source_mesh.vertices]
                safe=not lib.facade_volume_conflicts(source_mesh,matrix,bid)
                if aid.endswith('hoist_01'):safe=safe and all(lib.clear((p.x,p.y),.08,own=bid) for p in points if not inside((p.x,p.y),poly))
                if safe:
                    # Keep domestic openings from drawing across a cargo door.
                    # Remove only those existing parts that meet its real box.
                    if role=='harbor_warehouse_door':
                        low=[min(v[i] for v in points)-.03 for i in range(3)];high=[max(v[i] for v in points)+.03 for i in range(3)]
                        removed=set()
                        for item in lib.instances:
                            if item.get('sourceBuildingId')!=bid or item['role'] not in ('house_window','house_entrance','timber_panel'):continue
                            old=bpy.data.objects.get(item['object'])
                            vv=[old.matrix_world@v.co for v in old.data.vertices]
                            if all(min(v[i] for v in vv)<=high[i] and max(v[i] for v in vv)>=low[i] for i in range(3)):
                                removed.add(old.name);bpy.data.objects.remove(old,do_unlink=True)
                        lib.instances=[i for i in lib.instances if i['object'] not in removed]
                    o=place(aid,(*mid,.08),s=(1,1,sz),basis=basis,role=role,bid=bid);mounted.append(o.name)
                else:skipped.append({'buildingId':bid,'assetId':aid,'reason':'adjacent building or road clearance'})
            if mounted:break
        warehouses.append({'buildingId':bid,'objects':mounted})
    # Dock-side berths in stable order; the whole projected vessel stays in water.
    boats=[];occupied=[]
    variants=['harbor_rowboat_01','harbor_fishing_boat_01','harbor_merchant_ship_01']
    for i,dock in enumerate(d for d in source['terrain']['docks'] if d.get('waterbody','coast')=='coast'):
        p=pts(dock['points']);a,b=p[-2:];length=math.dist(a,b);u=((b[0]-a[0])/length,(b[1]-a[1])/length);n=(-u[1],u[0])
        aid=variants[i%3];entry=entries[aid];lo,hi=entry['bounds']['min'],entry['bounds']['max'];factor=.85 if i%3==2 else 1.0
        basis=Matrix(((u[0],n[0],0,0),(u[1],n[1],0,0),(0,0,1,0),(0,0,0,1)))
        done=False
        for t in (.78,.94,1.15,1.40):
            for sign in (-1,1):
                offset=dock['width']*scale/2+max(abs(lo[1]),abs(hi[1]))*factor+.70
                c=(a[0]+u[0]*length*t+n[0]*sign*offset,a[1]+u[1]*length*t+n[1]*sign*offset)
                ring=[(c[0]+u[0]*x*factor+n[0]*y*factor,c[1]+u[1]*x*factor+n[1]*y*factor) for x,y in ((lo[0],lo[1]),(hi[0],lo[1]),(hi[0],hi[1]),(lo[0],hi[1]))]
                if not all(inside(q,water) for q in ring_samples(ring)):continue
                if source.get('river') and overlaps(ring,pts(source['river']['surface']),.35):continue
                if any(overlaps(ring,q,.35) for q in dock_obstacles+occupied):continue
                o=place(aid,(*c,WATER_Z),(factor,)*3,basis,'harbor_boat');o['source_dock_id']=dock['id'];o['waterline_z']=WATER_Z
                o['hull_profile']=json.dumps(entry['hullProfile'])
                occupied.append(ring);boats.append({'object':o.name,'assetId':aid,'dockId':dock['id'],'waterlineZ':WATER_Z,'berthBounds':ring,'scale':factor});done=True;break
            if done:break
        if not done:skipped.append({'dockId':dock['id'],'assetId':aid,'reason':'no collision-free berth within the source sea'})
    boats.extend(place_river_boats(source,entries,place,scale,dock_obstacles,occupied))
    from harbor_water import exclude_boat_interiors
    water_exclusion=exclude_boat_interiors([bpy.data.objects[b['object']] for b in boats])
    return {'enabled':True,'version':2,'waterLevel':WATER_Z,'coastSide':coast['side'] if coast else None,'seaObject':surface.name if surface else None,'quaySegments':quay,'quayOpenings':quay_openings,'riverQuays':river_quays,'docks':docks,'warehouses':warehouses,'boats':boats,'waterExclusion':water_exclusion,'skippedMounts':skipped,'policy':'Source water boundaries and dock paths preserved. River berths retain planned positions and headings; reserved river routes avoid bridge footprints. Static water is excluded inside each hull.'}
