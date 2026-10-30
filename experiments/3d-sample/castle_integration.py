"""Fit the authored stone keep modules to existing Castle building polygons."""
import bpy
import json
import math
from mathutils import Matrix, Vector
from castle_layout import plan_keep


def wall_basis(tangent,normal):
    return Matrix(((tangent[0],-normal[0],0,0),(tangent[1],-normal[1],0,0),(0,0,1,0),(0,0,0,1)))


def mount_castle(library,record):
    lib=library;bid=record['id'];poly=record['footprint'];role=record['architecturalRole']
    plan=plan_keep(poly,record['roofAxes']['along'],role);eave=plan['eave'];n=len(poly)
    aid='castle_keep_masonry_01';template=lib.part(aid,'wall_core')
    # The kit's closed core is conformed to the source ring, including irregular
    # corners. Its bottom ring remains the exact authoritative building polygon.
    mesh=bpy.data.meshes.new(bid+' / authored stone keep core')
    verts=[(*p,.08) for p in poly]+[(*p,eave) for p in poly]
    faces=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh.from_pydata(verts,[],faces);mesh.materials.append(lib.castle_materials['stone']);mesh.update()
    layer=mesh.uv_layers.new(name='MetreUV')
    for face in mesh.polygons:
        if face.index<2:coords=[(mesh.vertices[i].co.x,mesh.vertices[i].co.y) for i in face.vertices]
        else:
            i=face.index-2;length=math.dist(poly[i],poly[(i+1)%n]);coords=[(0,.08),(length,.08),(length,eave),(0,eave)]
        for li,uv in zip(face.loop_indices,coords):layer.data[li].uv=uv
    wall=bpy.data.objects[bid+'_footprint_wall'];wall.data=mesh
    wall['representation']='authored_kit_adapted_shell';wall['architectural_role']=role
    wall['eave_height_m']=eave;wall['authored_asset_id']=aid;wall['asset_part']='wall_core / source polygon adaptation'
    wall['asset_mount_role']='castle_keep_shell';wall['castle_template_vertices']=len(template.vertices)
    lib.register(wall,aid,'castle_keep_shell',bid)
    record.update(eave=eave,floors=3 if role=='keep' else 2,floorHeight=eave/(3 if role=='keep' else 2),
                  roof='authored_stone_keep' if role=='keep' else 'authored_castle_service_hall',roofVolumes=1,
                  roofVolumeTypes=['inset_hipped_slate'],facadeStyle='castle_ashlar',dormers=[],chimneys=0,dormerMounts=[])
    us=[p[0]*plan['along'][0]+p[1]*plan['along'][1] for p in poly]
    record['roofPieces']=[{'polygon':poly,'planes':[(0,0,eave)],'eave':eave,'lo':min(us),'hi':max(us)}]
    record['castleLayout']=plan
    u,v=plan['along'],plan['across']
    basis=Matrix(((v[0],u[0],0,0),(v[1],u[1],0,0),(0,0,1,0),(0,0,0,1)))
    roof=plan['roof'];c=roof['center']
    lib.place('castle_keep_roof_01',(*c,eave-.015),scale=(roof['width']/12,roof['length']/16,roof['rise']/3),
              basis=basis,part='hipped_roof',building_id=bid,role='castle_keep_roof')
    if role=='keep':
        for turret in plan['turrets']:
            scale=turret['size']/3.2
            lib.place('castle_keep_turret_01',(*turret['center'],eave-.03),scale=(scale,)*3,basis=basis,
                      part='stone_turret',building_id=bid,role='castle_keep_turret')
        for a,b in zip(poly,poly[1:]+poly[:1]):
            length=math.dist(a,b);t=((b[0]-a[0])/length,(b[1]-a[1])/length);normal=(t[1],-t[0]);wb=wall_basis(t,normal)
            count=max(1,round(length/2.5));pitch=length/count
            for i in range(count):
                c=(a[0]+t[0]*(i+.5)*pitch-normal[0]*.12,a[1]+t[1]*(i+.5)*pitch-normal[1]*.12,eave-.03)
                transform=Matrix.Translation(Vector(c))@wb@Matrix.Diagonal((pitch/2.4,1,1,1))
                fitted=lib.fitted_mesh('castle_keep_parapet_01','parapet_bay',transform,poly)
                if fitted.vertices:lib.place('castle_keep_parapet_01',mesh=fitted,building_id=bid,role='castle_keep_parapet')
    # Stone bands and sparse openings replace all generic timber/shop fittings.
    facades=record['facades']
    gates=lib.castle_gate_points
    def entry_score(face):
        midpoint=tuple((face['a'][k]+face['b'][k])/2 for k in (0,1))
        return (min((math.dist(midpoint,g) for g in gates),default=0),-face['length'])
    exposed=[f for f in facades if f.get('exposed')]
    principal=min(exposed or facades,key=entry_score)
    for face in facades:
        a,b=face['a'],face['b'];length=math.dist(a,b);t=((b[0]-a[0])/length,(b[1]-a[1])/length)
        normal=face['out'];wb=wall_basis(t,normal);c=tuple((a[k]+b[k])/2 for k in (0,1))
        for z in (1.2,eave*.42,eave-.55):
            lib.place(aid,(*c,z),scale=(length/3,1,1),basis=wb,part='belt_course',building_id=bid,role='castle_masonry_detail')
        bays=max(1,int(length/7.4));pitch=length/bays
        for i in range(bays):
            p=(a[0]+t[0]*(i+.5)*pitch,a[1]+t[1]*(i+.5)*pitch)
            for z in ((3.0,eave*.48) if role=='keep' else (2.0,)):
                if face is principal and i==bays//2 and z<4:continue
                lib.place('castle_keep_openings_01',(*p,z),basis=wb,part='arrow_loop',building_id=bid,role='castle_window')
            if role=='keep' and i%2==0:
                lib.place('castle_keep_openings_01',(*p,eave-4.0),basis=wb,part='chamber_window',building_id=bid,role='castle_window')
        if face is principal:
            lib.place('castle_keep_openings_01',(*c,.12),basis=wb,part='entrance',building_id=bid,role='castle_entrance')
    top=max([eave+roof['rise']]+[eave+4.9*t['size']/3.2 for t in plan['turrets']])
    record['ridgeHeight']=top;record['authoredRoofAssetId']='castle_keep_roof_01'
    lib.special_buildings.append({'buildingId':bid,'wardType':'Castle','role':role,'roofAssetId':'castle_keep_roof_01',
                                 'bodyAssetId':aid,'turrets':len(plan['turrets']),'eave':eave,'height':top})
