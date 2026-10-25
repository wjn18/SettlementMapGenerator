"""Source-fit assembly examples, separate from the historic full-town scene.

Loads the delivered library first; keeps all d10 ground polygons and f2's exact
16-vertex basin. Roles are explicit design rules, not recovered source labels.
"""
import bpy,sys,json,math,hashlib,runpy
from pathlib import Path
from mathutils import Vector

HERE=Path(__file__).resolve().parent
OUT=HERE.parents[1]/'artifacts'/'small-town-assets'
SOURCE=HERE.parents[1]/'artifacts'/'3d-small-town'/'selection.json'
data=json.loads(SOURCE.read_text(encoding='utf-8-sig'))
kit=runpy.run_path(str(HERE/'build_asset_library.py'),run_name='st_demo')
kit['MATS'].update({key:bpy.data.materials['ST / '+key] for key in kit['PALETTE']})
Shape=kit['Shape']
template=next(s for s in bpy.data.scenes if s.name.startswith('SMALL TOWN /'))
records=[]


def polygon(b):return [(p['x']*.5,p['y']*.5) for p in b['points']]
def area(p):return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(p,p[1:]+p[:1]))/2)
def center(p):return (sum(x for x,y in p)/len(p),sum(y for x,y in p)/len(p))
def dist(p,a,b):
    v=Vector(b)-Vector(a);t=max(0,min(1,(Vector(p)-Vector(a)).dot(v)/v.length_squared))
    return (Vector(p)-Vector(a)-v*t).length
def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
def inside(p,poly):
    signs=[cross(a,b,p) for a,b in zip(poly,poly[1:]+poly[:1])]
    return min(signs)>=-1e-5 or max(signs)<=1e-5


def object_from_shape(scene,name,shape):
    mesh=shape.create_mesh(name);ob=bpy.data.objects.new(name,mesh);scene.collection.objects.link(ob)
    import bmesh
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
    uv=mesh.uv_layers.new(name='ST_uv_meters')
    for face in mesh.polygons:
        axis=max(range(3),key=lambda i:abs(face.normal[i]));axes=[i for i in range(3) if i!=axis]
        for li in face.loop_indices:
            co=mesh.vertices[mesh.loops[li].vertex_index].co;uv.data[li].uv=(co[axes[0]],co[axes[1]])
    return ob


def prism(s,poly,z0,z1,mat):
    n=len(poly)
    s.poly([(x,y,z) for z in (z0,z1) for x,y in poly],
           [tuple(reversed(range(n))),tuple(n+i for i in range(n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],mat)


def clip(poly,axis,value,positive):
    result=[]
    for a,b in zip(poly,poly[1:]+poly[:1]):
        da=sum(x*y for x,y in zip(a,axis))-value;db=sum(x*y for x,y in zip(b,axis))-value
        ina=da>=-1e-8 if positive else da<=1e-8
        inb=db>=-1e-8 if positive else db<=1e-8
        if ina:result.append(a)
        if ina!=inb:
            t=da/(da-db);result.append(tuple(a[i]+t*(b[i]-a[i]) for i in range(2)))
    return result


def fitted_hall(scene,b,role):
    p=polygon(b);c=center(p)
    a,bb=max(zip(p,p[1:]+p[:1]),key=lambda q:math.dist(*q))
    u=(Vector(bb)-Vector(a)).normalized();v=Vector((-u.y,u.x))
    values=[Vector(q).dot(v) for q in p];v0,v1=min(values),max(values);mid=(v0+v1)/2
    eave=10.2 if role=='main_hall' else (13 if role=='bell_tower' else 4.7+(int(b['id'][1:])%3)*.45)
    rise=(v1-v0)*(.54 if role=='main_hall' else .36)
    def zroof(q):return eave+rise*(1-abs(Vector(q).dot(v)-mid)/((v1-v0)/2))
    boundary=[]
    for a,bb in zip(p,p[1:]+p[:1]):
        boundary.append(a)
        da=Vector(a).dot(v)-mid;db=Vector(bb).dot(v)-mid
        if da*db < -1e-10:
            t=da/(da-db);boundary.append(tuple(a[i]+t*(bb[i]-a[i]) for i in range(2)))
    s=Shape();n=len(boundary)
    s.poly([(x,y,.08) for x,y in boundary]+[(x,y,zroof((x,y))) for x,y in boundary],
           [tuple(reversed(range(n)))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],'stone' if role!='annex' else 'plaster')
    wall=object_from_shape(scene,b['id']+'_footprint_wall',s)
    wall['source_building_id']=b['id'];wall['source_district_id']=b['districtId']
    wall['designed_role']=role;wall['source_points']=json.dumps(b['points'])
    roof=Shape()
    for side in (False,True):
        q=clip(p,v,mid,side)
        roof.poly([(x,y,zroof((x,y))+.025) for x,y in q],[tuple(range(len(q)))],'slate')
        low,high=(mid,v1) if side else (v0,mid)
        for j in range(max(2,int((high-low)/.34))):
            value=low+(j+.5)*.34
            cuts=[]
            for a,bb in zip(q,q[1:]+q[:1]):
                aa=Vector(a).dot(v)-value;bbb=Vector(bb).dot(v)-value
                if aa*bbb<0:
                    t=aa/(aa-bbb);cuts.append(tuple(a[i]+t*(bb[i]-a[i]) for i in range(2)))
            if len(cuts)==2:roof.beam((*cuts[0],zroof(cuts[0])+.045),(*cuts[1],zroof(cuts[1])+.045),.014,'ink',4)
    for a,bb in zip(p,p[1:]+p[:1]):
        roof.beam((*a,zroof(a)+.02),(*bb,zroof(bb)+.02),.11,'limestone')
    object_from_shape(scene,b['id']+'_fitted_roof',roof)['asset_recipe']='cathedral_roof_01' if role=='main_hall' else 'cathedral_annex_01'
    # Only exposed wall edges receive openings. Shared walls remain bare.
    windows=0
    all_p=[polygon(other) for other in buildings if other['id']!=b['id']]
    signed=sum(a[0]*bb[1]-bb[0]*a[1] for a,bb in zip(p,p[1:]+p[:1]))
    for a,bb in zip(p,p[1:]+p[:1]):
        along=(Vector(bb)-Vector(a)).normalized()
        normal=Vector((along.y,-along.x))*(1 if signed>0 else -1)
        midpoint=(Vector(a)+Vector(bb))*.5
        if any(inside(midpoint+normal*.25,other) for other in all_p):continue
        count=max(1,int(math.dist(a,bb)/3.2))
        for j in range(count):
            pos=Vector(a).lerp(Vector(bb),(j+.5)/count)
            s=Shape();kit['arch'](s,1.30 if role=='main_hall' else .9,1.45 if role=='main_hall' else .8,z=0)
            verts=[]
            for x,y,z in s.vertices:
                pt=pos+along*x-normal*y;verts.append((pt.x,pt.y,z+(4 if role=='main_hall' else 1.4)))
            s.vertices=verts
            object_from_shape(scene,b['id']+'_lancet_'+str(windows),s)['asset_recipe']='cathedral_openings_01'
            windows+=1
    records.append({'sourceBuildingId':b['id'],'role':role,'footprint':p,'eave':eave,'windowCount':windows,
                    'rule':'largest area = main hall; nearest sufficiently square remaining footprint = bell tower; others = annex',
                    'roleIsDesignInterpretation':True})
    return c,p,eave,rise


def add_instance(scene,asset_id,location,scale=1):
    ob=bpy.data.objects.new('FITTED / '+asset_id,None);scene.collection.objects.link(ob)
    ob.instance_type='COLLECTION';ob.instance_collection=bpy.data.collections[asset_id]
    ob.location=location;ob.scale=(scale,)*3
    return ob


def add_part(scene,asset_id,part,location,scale):
    source=next(o for o in bpy.data.collections[asset_id].objects if o.get('part_role')==part)
    ob=source.copy();ob.parent=None;scene.collection.objects.link(ob)
    ob.location=location;ob.scale=scale
    return ob


def setup_render(scene,pts,name):
    scene.world=template.world;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
        for d in prefs.devices:d.use=d.type!='CPU'
        scene.cycles.device='GPU'
    except Exception:pass
    scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    scene.view_settings.view_transform='Standard';scene.view_settings.look='None'
    light=bpy.data.lights.new(name+' sun','SUN');light.energy=1.7;light.angle=.17
    ob=bpy.data.objects.new(light.name,light);scene.collection.objects.link(ob);ob.rotation_euler=(.40,-.4,-.3)
    cam=bpy.data.objects.new(name+' camera',bpy.data.cameras.new(name+' camera'));scene.collection.objects.link(cam);scene.camera=cam
    cam.data.type='ORTHO';cam.data.clip_end=1000
    focus=sum(pts,Vector())/len(pts);cam.location=focus+Vector((55,-75,75));cam.rotation_euler=(focus-cam.location).to_track_quat('-Z','Y').to_euler()
    bpy.context.view_layer.update();inv=cam.matrix_world.inverted();proj=[inv@p for p in pts]
    lo=[min(p[i] for p in proj) for i in (0,1)];hi=[max(p[i] for p in proj) for i in (0,1)]
    cam.location+=cam.matrix_world.to_3x3()@Vector(((lo[0]+hi[0])/2,(lo[1]+hi[1])/2,0))
    cam.data.ortho_scale=max(hi[0]-lo[0],(hi[1]-lo[1])*1.2)*1.18
    scene.render.resolution_x=1800;scene.render.resolution_y=1500;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/'previews'/(name+'.png'))
    scene.render.use_freestyle=True;fs=scene.view_layers[0].freestyle_settings
    ls=fs.linesets[0] if fs.linesets else fs.linesets.new('Ink')
    ls.select_crease=False;ls.select_silhouette=True;ls.select_border=True
    ls.linestyle.color=(.13,.11,.08);ls.linestyle.thickness=.8
    floor=Shape();floor.box((focus.x,focus.y,-.1),(200,200,.15),'paper');object_from_shape(scene,'Paper',floor)


buildings=[b for b in data['buildings'] if b['wardType']=='Cathedral']
main=max(buildings,key=lambda b:area(polygon(b)))
candidates=[b for b in buildings if b['id']!=main['id']]
def tower_score(b):
    p=polygon(b);lengths=[math.dist(a,bb) for a,bb in zip(p,p[1:]+p[:1])]
    ratio=max(lengths)/min(lengths)
    return (0 if ratio<1.25 else 1,math.dist(center(p),center(polygon(main))),b['id'])
tower=min(candidates,key=tower_score)
church=bpy.data.scenes.new('SOURCE FIT / d10 cathedral district');bpy.context.window.scene=church
for b in buildings:
    role='main_hall' if b['id']==main['id'] else ('bell_tower' if b['id']==tower['id'] else 'annex')
    c,p,eave,rise=fitted_hall(church,b,role)
    if role=='bell_tower':
        radius=min(dist(c,a,bb) for a,bb in zip(p,p[1:]+p[:1]))
        scale=min(1.4,radius*.75/1.75)
        # Tower platform retains the original base polygon; upper module is inscribed.
        platform=Shape();prism(platform,p,eave,eave+rise+.15,'stone')
        object_from_shape(church,b['id']+'_tower_platform',platform)
        add_instance(church,'cathedral_belfry_01',(*c,eave+rise+.15),scale)
church['source_file']=str(SOURCE);church['role_policy']='Design interpretation, not semantic source labels.'
pts=[Vector((x,y,z)) for b in buildings for x,y in polygon(b) for z in (0,25)]
setup_render(church,pts,'source-fit-cathedral')

fountain=bpy.data.scenes.new('SOURCE FIT / f2 fountain');bpy.context.window.scene=fountain
f=next(f for f in data['features'] if f['id']=='f2');poly=polygon(f);c=center(poly)
base=Shape();prism(base,poly,0,.22,'stone')
base_ob=object_from_shape(fountain,'f2_exact_footprint_base',base)
base_ob['source_feature_id']='f2';base_ob['asset_role']='exact_footprint_base'
radius=min(math.dist(c,p) for p in poly)
basin=add_instance(fountain,'fountain_basin_01',(*c,0),radius/2)
# Correct the basin height after planar scaling; canonical radial perimeter shares the same 16 directions.
basin.scale=(radius/2,radius/2,1)
add_instance(fountain,'fountain_ornament_01',(*c,.22),1)
add_part(fountain,'water_flow_01','surface_and_ripples',(*c,.48),(radius/2,radius/2,1))
add_part(fountain,'water_flow_01','water_jets',(*c,.48),(1,1,1))
fountain['source_feature_id']='f2';fountain['footprint_policy']='The source polygon is used without translation or resampling.'
pts=[Vector((x,y,z)) for x,y in poly for z in (0,3.2)]
setup_render(fountain,pts,'source-fit-fountain')

# Independently inspect the actual bottom vertices, not just generated records.
checks=[]
for scene,originals,prefix in ((church,buildings,'building'),(fountain,[f],'feature')):
    for original in originals:
        expected=polygon(original)
        name=original['id']+('_footprint_wall' if prefix=='building' else '_exact_footprint_base')
        ob=bpy.data.objects[name]
        verts=[ob.matrix_world@v.co for v in ob.data.vertices];zmin=min(v.z for v in verts)
        actual=[(v.x,v.y) for v in verts if abs(v.z-zmin)<1e-5]
        actual_edges=list(zip(actual,actual[1:]+actual[:1]));expected_edges=list(zip(expected,expected[1:]+expected[:1]))
        error=max(max(min(dist(p,a,b) for a,b in expected_edges) for p in actual),max(min(dist(p,a,b) for a,b in actual_edges) for p in expected))
        area_error=abs(area(actual)-area(expected))
        checks.append({'sourceId':original['id'],'actualObject':name,'maxBoundaryErrorSceneUnits':error,'maxBoundaryErrorPlanUnits':error/.5,
                       'areaErrorSceneUnitsSquared':area_error,'passed':error/.5<1e-4 and area_error<1e-3})
assert all(c['passed'] for c in checks),checks
report={'passed':True,'sourceSha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'horizontalScale':.5,
        'roleAssignments':records,'footprintChecks':checks,'scope':'10 d10 buildings and f2 only; original full-town scene unchanged.'}
(OUT/'source-fit-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'cathedral-role-map.json').write_text(json.dumps({'mainHall':main['id'],'bellTower':tower['id'],'roles':records,'sourceRoles':False},ensure_ascii=False,indent=2),encoding='utf-8')
bpy.context.window.scene=church
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source-fit-demo.blend'))
for scene in (church,fountain):
    bpy.context.window.scene=scene;bpy.ops.render.render(write_still=True)
print('SOURCE_FIT_PASS',flush=True)
