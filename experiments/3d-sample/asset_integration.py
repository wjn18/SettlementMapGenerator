"""Mount the authored small-town collections on the planner's existing geometry.

Only vertical architecture and decoration are designed here. Ground polygons,
road meshes, wall centerlines, and source identifiers remain the adapter's data.
"""
import bpy
import bmesh
import hashlib
import json
import math
import random
from collections import Counter
from pathlib import Path
from mathutils import Matrix, Vector
from mathutils.geometry import tessellate_polygon
from mathutils.bvhtree import BVHTree
from props import inside, segment_distance, boundary_distance

DEFAULT_LIBRARY = Path(__file__).resolve().parents[2] / 'artifacts' / 'small-town-assets' / 'small-town-asset-library.blend'


def stable_index(key, count):
    return int(hashlib.sha256(key.encode()).hexdigest()[:12], 16) % count


def signed_area(poly):
    return sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(poly,poly[1:]+poly[:1]))/2


def centroid(poly):
    return (sum(p[0] for p in poly)/len(poly),sum(p[1] for p in poly)/len(poly))


def mesh_bounds(mesh, matrix=Matrix.Identity(4)):
    pts=[matrix@v.co for v in mesh.vertices]
    return ([min(v[i] for v in pts) for i in range(3)], [max(v[i] for v in pts) for i in range(3)])


def wall_basis(tangent, normal):
    return Matrix(((tangent[0],-normal[0],0,0), (tangent[1],-normal[1],0,0),
                   (0,0,1,0),(0,0,0,1)))


def roof_height(record, point):
    u=record['roofAxes']['along'];along=point[0]*u[0]+point[1]*u[1]
    pieces=record['roofPieces']
    piece=next((p for p in pieces if p['lo']-1e-5<=along<=p['hi']+1e-5),pieces[-1])
    return min(a*point[0]+b*point[1]+c for a,b,c in piece['planes'])


class AssetLibrary:
    def __init__(self, filepath=DEFAULT_LIBRARY):
        self.path=Path(filepath).resolve()
        manifest_path=self.path.with_name('asset-library.json')
        if not self.path.is_file() or not manifest_path.is_file():
            raise FileNotFoundError('Authored asset library is required: '+str(self.path)+'. Build it with build_asset_library.py, or explicitly use --legacy-assets.')
        self.manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
        self.entries={e['id']:e for e in self.manifest['assets']}
        with bpy.data.libraries.load(str(self.path),link=False) as (source,target):
            missing=set(self.entries)-set(source.collections)
            if missing:raise ValueError('Asset library collections missing: '+str(sorted(missing)))
            target.collections=list(self.entries)
        self.collections={c.name:c for c in target.collections}
        self.slots=list(self.manifest['materialSlots'])
        first=next(o for o in self.collections['cathedral_roof_01'].objects if o.type=='MESH')
        self.materials={key:first.data.materials[i] for i,key in enumerate(self.slots)}
        self.cache={};self.instances=[];self.skipped=[];self.roles=[];self.gate_mounts=[]
        self.groves=[];self.fountains=[];self.special_buildings=[]
        self.container=bpy.data.collections.new('06_AUTHORED_ASSETS')
        bpy.context.scene.collection.children.link(self.container)
        self.buildings=[];self.roads=[];self.occupied=[]

    def part(self, asset_id, role=None, subset=None):
        key=(asset_id,role,subset)
        if key in self.cache:return self.cache[key]
        candidates=[o for o in self.collections[asset_id].objects if o.type=='MESH' and (role is None or o.get('part_role')==role)]
        if len(candidates)!=1:raise ValueError('Specify one mesh part for '+str(key))
        source=candidates[0].data
        if not subset:self.cache[key]=source;return source
        predicate={'ridge':lambda v:abs(v.x)<.65,
                   'eave_left':lambda v:v.x<-.65,
                   'eave_right':lambda v:v.x>.65,
                   'farm_core':lambda v:v.y>=-.30}[subset]
        faces=[p for p in source.polygons if all(predicate(source.vertices[i].co) for i in p.vertices)]
        used=sorted({i for p in faces for i in p.vertices});lookup={v:i for i,v in enumerate(used)}
        mesh=bpy.data.meshes.new(asset_id+' / '+subset)
        mesh.from_pydata([source.vertices[i].co[:] for i in used],[],[tuple(lookup[i] for i in p.vertices) for p in faces])
        for mat in source.materials:mesh.materials.append(mat)
        layer=mesh.uv_layers.new(name='ST_uv_meters')
        for out,original in zip(mesh.polygons,faces):
            out.material_index=original.material_index
            for a,b in zip(out.loop_indices,original.loop_indices):layer.data[a].uv=source.uv_layers.active.data[b].uv
        mesh.update();self.cache[key]=mesh
        return mesh

    def place(self, asset_id, position=(0,0,0), scale=(1,1,1), basis=None, part=None,
              subset=None, pivot=(0,0,0), building_id=None, feature_id=None,
              role='decoration', collection=None, mesh=None, record=True):
        source=mesh or self.part(asset_id,part,subset)
        matrix=Matrix.Translation(Vector(position))@(basis or Matrix.Identity(4))@Matrix.Diagonal((*scale,1))@Matrix.Translation(-Vector(pivot))
        facade_roles={'special_facade','patriciate_cornice','timber_panel','house_window','house_entrance','cathedral_window','cathedral_entrance'}
        if role in facade_roles and self.facade_volume_conflicts(source,matrix,building_id):
            self.skipped.append({'buildingId':building_id,'assetId':asset_id,'role':role,'reason':'actual component intersects an adjacent building volume'})
            return None
        obj=bpy.data.objects.new('Asset_'+asset_id+'_'+str(len(self.instances)),source)
        (collection or self.container).objects.link(obj)
        obj.matrix_world=matrix
        obj['authored_asset_id']=asset_id;obj['asset_part']=part or subset or 'main'
        obj['asset_mount_role']=role;obj['representation']='authored_3d_kit'
        if building_id:obj['source_building_id']=building_id
        if feature_id:obj['source_feature_id']=feature_id
        if record:self.register(obj,asset_id,role,building_id,feature_id)
        return obj

    def register(self,obj,asset_id,role,building_id=None,feature_id=None):
        self.instances.append({'object':obj.name,'assetId':asset_id,'gapId':self.entries[asset_id]['gapId'],
                               'role':role,'sourceBuildingId':building_id,'sourceFeatureId':feature_id})

    def clear(self,p, radius, own=None, roads=True):
        if any(bid!=own and (inside(p,poly) or boundary_distance(p,poly)<radius+.08) for bid,poly in self.buildings):return False
        if roads and any(segment_distance(p,a,b)<w*.5+radius+.12 for a,b,w in self.roads):return False
        return True

    def facade_clear(self,mesh,matrix,own):
        lo,hi=mesh_bounds(mesh,matrix)
        # Sample the real projected vertex hull; this also covers rotated panels.
        points=[matrix@v.co for v in mesh.vertices]
        unique={(round(p.x,3),round(p.y,3)) for p in points}
        return all(self.clear(p,.045,own=own,roads=False) for p in unique)

    def facade_volume_conflicts(self,mesh,matrix,own):
        points=[matrix@v.co for v in mesh.vertices]
        if not points:return False
        lo=[min(p[i] for p in points) for i in (0,1)];hi=[max(p[i] for p in points) for i in (0,1)]
        near=[bid for bid,box in self.building_boxes.items() if bid!=own and lo[0]<=box[1] and hi[0]>=box[0] and lo[1]<=box[3] and hi[1]>=box[2]]
        if not near:return False
        samples=points+[matrix@f.center for f in mesh.polygons]
        for bid in near:
            poly=self.record_by_id[bid]['footprint']
            for p in samples:
                q=(p.x,p.y)
                if inside(q,poly) and boundary_distance(q,poly)>.02 and .08<p.z<roof_height(self.record_by_id[bid],q)-.02:return True
        return False

    def fitted_mesh(self,asset_id,part,matrix,polygon,subset=None):
        """Clip actual library polygons to the supplied footprint, carrying UVs."""
        source=self.part(asset_id,part,subset)
        poly=polygon[:] if signed_area(polygon)>0 else list(reversed(polygon))
        turns=[(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]) for a,b,c in zip(poly,poly[1:]+poly[:1],poly[2:]+poly[:2])]
        if min(turns)>=-1e-7:clip_polys=[poly]
        else:
            vectors=[Vector((*p,0)) for p in poly]
            triangles=tessellate_polygon([vectors])
            clip_polys=[[(vectors[v].x,vectors[v].y) if isinstance(v,int) else (v.x,v.y) for v in triangle] for triangle in triangles]
        vertices=[];faces=[];uvs=[];indices=[]
        for face in source.polygons:
            initial=[(matrix@source.vertices[source.loops[li].vertex_index].co,Vector(source.uv_layers.active.data[li].uv)) for li in face.loop_indices]
            for boundary in clip_polys:
                points=initial[:]
                for a,b in zip(boundary,boundary[1:]+boundary[:1]):
                    if not points:break
                    out=[]
                    def distance(v):return (b[0]-a[0])*(v.y-a[1])-(b[1]-a[1])*(v.x-a[0])
                    for p,q in zip(points,points[1:]+points[:1]):
                        dp,dq=distance(p[0]),distance(q[0]);ip,iq=dp>=-1e-7,dq>=-1e-7
                        if ip:out.append(p)
                        if ip!=iq:
                            t=dp/(dp-dq);out.append((p[0].lerp(q[0],t),p[1].lerp(q[1],t)))
                    points=out
                cleaned=[]
                for item in points:
                    if not cleaned or (item[0]-cleaned[-1][0]).length>1e-7:cleaned.append(item)
                if len(cleaned)>2 and (cleaned[0][0]-cleaned[-1][0]).length<1e-7:cleaned.pop()
                if len(cleaned)<3:continue
                offset=len(vertices);vertices.extend([v[:] for v,uv in cleaned]);uvs.append([uv[:] for v,uv in cleaned])
                faces.append(tuple(range(offset,offset+len(cleaned))));indices.append(face.material_index)
        mesh=bpy.data.meshes.new(asset_id+' / fitted to source')
        mesh.from_pydata(vertices,[],faces)
        for mat in source.materials:mesh.materials.append(mat)
        layer=mesh.uv_layers.new(name='ST_uv_meters')
        for face,coords,slot in zip(mesh.polygons,uvs,indices):
            face.material_index=slot
            for li,uv in zip(face.loop_indices,coords):layer.data[li].uv=uv
        mesh.update()
        bm=bmesh.new();bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6)
        bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-7)
        bm.to_mesh(mesh);bm.free();mesh.update()
        return mesh

    def design_roles(self,records):
        districts={}
        for r in records:
            if r.get('wardType')=='Cathedral':districts.setdefault(r['districtId'],[]).append(r)
        for district,group in districts.items():
            main=max(group,key=lambda r:(abs(signed_area(r['footprint'])),r['id']))
            remaining=[r for r in group if r is not main]
            def score(r):
                p=r['footprint'];lengths=[math.dist(a,b) for a,b in zip(p,p[1:]+p[:1])]
                return (0 if max(lengths)/min(lengths)<1.25 else 1,math.dist(centroid(p),centroid(main['footprint'])),r['id'])
            tower=min(remaining,key=score) if remaining else None
            for r in group:
                r['architecturalRole']='main_hall' if r is main else ('bell_tower' if r is tower else 'annex')
                self.roles.append({'districtId':district,'buildingId':r['id'],'role':r['architecturalRole'],
                                   'rule':'largest footprint = main hall; nearest square remaining volume = tower; others = annex',
                                   'sourceSemantic':False})

    def special_shell(self,record):
        bid=record['id'];poly=record['footprint'];role=record.get('architecturalRole')
        u=Vector(record['roofAxes']['along']);across=Vector((u.y,-u.x))
        us=[Vector(p).dot(u) for p in poly];xs=[Vector(p).dot(across) for p in poly]
        length,width=max(us)-min(us),max(xs)-min(xs)
        um,xm=(max(us)+min(us))/2,(max(xs)+min(xs))/2
        ward=record['wardType'];variant=stable_index(bid,2)
        if ward=='Cathedral':
            eave=10.4 if role=='main_hall' else (14.2 if role=='bell_tower' else 4.8+stable_index(bid,3)*.4)
            rise=min(width*(.53 if role=='main_hall' else .38),8)
            asset_id='cathedral_roof_01' if role=='main_hall' else 'cathedral_annex_01'
            roof_part='roof_and_cornice' if role=='main_hall' else 'roof'
            base_w,base_l,base_z,base_rise=(6,8,0,3) if role=='main_hall' else (4.3,3.2,3.1,1.25)
            wall_mat='stone' if role!='annex' else 'plaster'
        else:
            eave=min(record['eave'],5.9) if ward=='Farm' else record['eave']
            rise=min(width*.45,6)
            asset_id=('farm_cottage_01','farm_barn_01')[variant] if ward=='Farm' else 'cathedral_roof_01'
            roof_part='roof' if ward=='Farm' else 'roof_and_cornice'
            base_w,base_l,base_z,base_rise=(4.8,4.8,3.1,1.8) if ward=='Farm' else (6,8,0,3)
            wall_mat='plaster' if ward!='Farm' or variant==0 else 'oak_light'
        # A square tower has a closed horizontal platform at the original walls.
        def top(p):return eave if role=='bell_tower' else eave+rise*(1-abs(Vector(p).dot(across)-xm)/(width/2))
        boundary=[]
        for a,b in zip(poly,poly[1:]+poly[:1]):
            boundary.append(a)
            da,db=Vector(a).dot(across)-xm,Vector(b).dot(across)-xm
            if role!='bell_tower' and da*db<-1e-10:
                t=da/(da-db);boundary.append(tuple(a[i]+t*(b[i]-a[i]) for i in range(2)))
        wall=bpy.data.objects[bid+'_footprint_wall'];n=len(boundary)
        mesh=bpy.data.meshes.new(bid+' / authored shell')
        verts=[(*p,.08) for p in boundary]+[(*p,top(p)) for p in boundary]
        faces=[tuple(reversed(range(n)))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        if role=='bell_tower':faces.append(tuple(range(n,n*2)))
        mesh.from_pydata(verts,[],faces);mesh.materials.append(self.materials[wall_mat]);mesh.update()
        uv=mesh.uv_layers.new(name='MetreUV')
        for face in mesh.polygons:
            for li in face.loop_indices:
                co=mesh.vertices[mesh.loops[li].vertex_index].co;uv.data[li].uv=(co.x+co.y,co.z)
        wall.data=mesh;wall['representation']='authored_kit_adapted_shell'
        wall['architectural_role']=role or ward;wall['eave_height_m']=eave
        record['eave']=eave;record['ridgeHeight']=eave if role=='bell_tower' else eave+rise
        record['roof']='authored_flat_tower' if role=='bell_tower' else 'authored_footprint_gable'
        c=u*um+across*xm
        if role=='bell_tower':
            center=centroid(poly);radius=min(segment_distance(center,a,b) for a,b in zip(poly,poly[1:]+poly[:1]))
            scale=min(1.4,radius*.76/1.80)
            for part in ('upper_tower','bell'):
                self.place('cathedral_belfry_01',(*center,eave),scale=(scale,)*3,part=part,building_id=bid,role='bell_tower_upper')
        else:
            basis=Matrix(((across.x,u.x,0,c.x),(across.y,u.y,0,c.y),(0,0,1,eave),(0,0,0,1)))
            transform=basis@Matrix.Diagonal((width/base_w,length/base_l,rise/base_rise,1))@Matrix.Translation(Vector((0,0,-base_z)))
            fitted=self.fitted_mesh(asset_id,roof_part,transform,poly)
            self.place(asset_id,part=roof_part,mesh=fitted,building_id=bid,role='footprint_fitted_roof')
        record['authoredRoofAssetId']=asset_id if role!='bell_tower' else 'cathedral_belfry_01'
        # Store the exact new affine planes for later facade and dormer mounting.
        s=rise/(width/2)
        planes=[(across.x*s,across.y*s,eave+rise-s*xm),(-across.x*s,-across.y*s,eave+rise+s*xm)]
        if role=='bell_tower':planes=[(0,0,eave)]
        record['roofPieces']=[{'polygon':poly,'planes':planes,'eave':eave,'lo':min(us),'hi':max(us)}]
        record['floors']=max(1,round(eave/3));record['floorHeight']=eave/record['floors']
        self.special_buildings.append({'buildingId':bid,'wardType':ward,'role':role or ward,'roofAssetId':record['authoredRoofAssetId']})

    def architecture(self,data,records):
        self.buildings=[(r['id'],r['footprint']) for r in records]
        self.record_by_id={r['id']:r for r in records}
        self.building_boxes={r['id']:(min(x for x,y in r['footprint']),max(x for x,y in r['footprint']),min(y for x,y in r['footprint']),max(y for x,y in r['footprint'])) for r in records}
        self.roads=[(a,b,r['width']) for r in data['roads'] for pts in [[(p['x'],p['y']) for p in r['points']]] for a,b in zip(pts,pts[1:])]
        self.design_roles(records)
        generic_suffixes={'primary_oak','secondary_joinery','roof_rims','ridge_caps','window_recesses','window_leads','weathered_shutters','window_iron'}
        for record in records:
            bid=record['id'];special=record.get('wardType') in ('Cathedral','Farm','PatriciateWard')
            for obj in list(bpy.context.scene.objects):
                if not obj.name.startswith(bid+'_') or obj.name==bid+'_footprint_wall':continue
                suffix=obj.name[len(bid)+1:]
                if (special and record['wardType']!='PatriciateWard') or suffix in generic_suffixes or suffix.startswith('dormer_'):
                    bpy.data.objects.remove(obj,do_unlink=True)
            if special and record['wardType']!='PatriciateWard':self.special_shell(record)
            elif record.get('wardType')=='PatriciateWard':
                self.special_buildings.append({'buildingId':bid,'wardType':'PatriciateWard','role':'patriciate_house','roofAssetId':'retained_footprint_roof'})
        for record in records:
            special=record.get('wardType') in ('Cathedral','Farm','PatriciateWard')
            self.mount_facades(record)
            if not special or record['wardType']=='PatriciateWard':self.mount_roof_details(record)
        bpy.context.view_layer.update()

    def mount_facades(self,record):
        bid=record['id'];ward=record.get('wardType');special=ward in ('Cathedral','Farm','PatriciateWard')
        faces=[f for f in record['facades'] if f.get('exposed')]
        principal=max(faces,key=lambda f:(f.get('streetFacing',False),f['length']),default=None)
        for side,face in enumerate(faces):
            a,b=face['a'],face['b'];length=math.dist(a,b)
            t=((b[0]-a[0])/length,(b[1]-a[1])/length);normal=face['out'];basis=wall_basis(t,normal)
            if special and ward in ('Farm','PatriciateWard'):
                if face is not principal:continue
                aid=(('farm_cottage_01','farm_barn_01') if ward=='Farm' else ('patriciate_facade_01','patriciate_facade_02'))[stable_index(bid,2)]
                part='facade_and_shelter' if ward=='Farm' else 'windows_and_entrance'
                sx=min(1.8,(length-.4)/(4.8 if ward=='Farm' else 5.6));sz=min(1.45,(record['eave']-.18)/(3.1 if ward=='Farm' else 4.2))
                p=Vector((*centroid([a,b]),.10))+Vector((*normal,0))*.05
                source=self.part(aid,part);transform=Matrix.Translation(p)@basis@Matrix.Diagonal((sx,1,sz,1))
                subset=None
                if not self.facade_clear(source,transform,bid):
                    if ward=='Farm':subset='farm_core';source=self.part(aid,part,subset)
                    if not self.facade_clear(source,transform,bid):
                        self.skipped.append({'buildingId':bid,'assetId':aid,'reason':'facade projection intersects a neighbouring footprint'});continue
                self.place(aid,p,scale=(sx,1,sz),basis=basis,part=part,subset=subset,building_id=bid,role='special_facade')
                if ward=='PatriciateWard':
                    self.place(aid,(p.x,p.y,record['eave']-4.42),scale=(sx,1,1),basis=basis,part='cornice',building_id=bid,role='patriciate_cornice')
                continue
            bays=max(1,round(length/(3.6 if ward=='Cathedral' else 3.2)));bay=length/bays
            for j in range(bays):
                distance=(j+.5)*bay;p=Vector((a[0]+t[0]*distance,a[1]+t[1]*distance,0))
                if not self.clear((p.x+normal[0]*.3,p.y+normal[1]*.3),.04,own=bid,roads=False):continue
                if ward=='Cathedral':
                    aid='cathedral_openings_01';part='lancet_window'
                    scale=min(1.2,(bay-.4)/1.8)
                    z=3.4 if record.get('architecturalRole')=='main_hall' else 1.15
                    if z+3.45*scale>=roof_height(record,(p.x,p.y))-.25:scale=min(scale,(roof_height(record,(p.x,p.y))-z-.25)/3.45)
                    if scale>.35:self.place(aid,(p.x,p.y,z),scale=(scale,)*3,basis=basis,part=part,building_id=bid,role='cathedral_window')
                    if face is principal and j==bays//2:
                        self.place(aid,(p.x,p.y,.10),scale=(min(1.1,bay/2.3),1,.80),basis=basis,part='pointed_door',pivot=(2.65,0,0),building_id=bid,role='cathedral_entrance')
                    continue
                for floor in range(record['floors']):
                    z0=.20+floor*record['floorHeight']
                    q0=(a[0]+t[0]*(j*bay+.08),a[1]+t[1]*(j*bay+.08))
                    q1=(a[0]+t[0]*((j+1)*bay-.08),a[1]+t[1]*((j+1)*bay-.08))
                    h=min(record['floorHeight']-.16,roof_height(record,q0)-z0-.10,roof_height(record,q1)-z0-.10)
                    if h<1:continue
                    timber='timber_panel_0'+str(1+stable_index(bid,4))
                    self.place(timber,(p.x,p.y,z0),scale=(bay*.94/3.12,1,h/2.5),basis=basis,building_id=bid,role='timber_panel')
                    if floor==0 and face.get('streetFacing'):continue
                    number=1+stable_index(bid+':'+str(j+side),3)
                    opening='opening_0'+str(number)
                    native_h=self.entries[opening]['bounds']['max'][2]
                    sc=min(1,(bay-.35)/self.entries[opening]['dimensions'][0],(h-.45)/native_h)
                    if sc>.35:self.place(opening,(p.x+normal[0]*.10,p.y+normal[1]*.10,z0+.37),scale=(sc,)*3,basis=basis,building_id=bid,role='house_window')
            if not special and face is principal and length>2.5:
                p=centroid([a,b]);opening='opening_0'+str(4+stable_index(bid,3))
                self.place(opening,(*p,.10),scale=(.85,)*3,basis=basis,building_id=bid,role='house_entrance')

    def mount_roof_details(self,record):
        bid=record['id'];u=Vector(record['roofAxes']['along']);v=Vector((u.y,-u.x))
        basis=Matrix(((v.x,u.x,0,0),(v.y,u.y,0,0),(0,0,1,0),(0,0,0,1)))
        aid='roof_ridge_eave_0'+str(1+stable_index(bid,3))
        for piece in record['roofPieces']:
            poly=piece['polygon'];um=(piece['lo']+piece['hi'])/2
            vs=[Vector(p).dot(v) for p in poly];best=None
            for j in range(81):
                q=u*um+v*(min(vs)+(max(vs)-min(vs))*j/80)
                if inside(q,poly):
                    z=roof_height(record,q)
                    if best is None or z>best[0]:best=(z,q)
            if best is None:continue
            z,q=best;sy=max(.1,(piece['hi']-piece['lo'])/3)
            transform=Matrix.Translation(Vector((q.x,q.y,z+.02)))@basis@Matrix.Diagonal((1,sy,1,1))
            fitted=self.fitted_mesh(aid,None,transform,poly,subset='ridge')
            if fitted.vertices:self.place(aid,mesh=fitted,building_id=bid,role='ridge_detail')
        for i,mount in enumerate(record.get('dormerMounts',[])):
            aid='dormer_0'+str(1+stable_index(bid+str(i),3))
            basis=wall_basis(mount['along'],mount['out']);center=mount['center']
            sx=min(1.1,mount['width']/1.7);sy=mount['depth']/1.6
            # The saved native roof clearances determine a vertical warp of the
            # actual dormer mesh, so the rear roof cannot cover its window.
            source=self.part(aid).copy()
            target_eave=max(1.15,mount['eave']-mount['base'])
            for vert in source.vertices:vert.co.z*=target_eave/1.2
            transform=Matrix.Translation(Vector((*center,mount['base'])))@basis@Matrix.Diagonal((sx,sy,1,1))
            corners=[transform@vert.co for vert in source.vertices]
            if not all(inside((p.x,p.y),record['footprint']) or boundary_distance((p.x,p.y),record['footprint'])<1e-5 for p in corners):
                self.skipped.append({'buildingId':bid,'assetId':aid,'reason':'roof mounting bounds leave the source footprint'});continue
            self.place(aid,(*center,mount['base']),scale=(sx,sy,1),basis=basis,mesh=source,building_id=bid,role='dormer')

    def replace_features(self,data,stats):
        feature_by_id={f['id']:f for f in data.get('features',[])}
        for record in stats.get('groves',[]):
            fid=record['sourceId'];feature=feature_by_id[fid];poly=[(p['x'],p['y']) for p in feature['points']]
            base=bpy.data.objects[record['groundObject']];base['representation']='authored_kit_region'
            trees=[]
            for i in range(record['treeCount']):
                prefix='Grove_'+fid+'_'+str(i)
                trunk=bpy.data.objects[prefix+'_trunk'];crown=bpy.data.objects[prefix+'_crown']
                points=[trunk.matrix_world@v.co for v in trunk.data.vertices[:8]]
                q=(sum(p.x for p in points)/8,sum(p.y for p in points)/8)
                allowed=min([boundary_distance(q,poly)-.03]+
                            [boundary_distance(q,p)-.25 for bid,p in self.buildings]+
                            [segment_distance(q,a,b)-w/2-.12 for a,b,w in self.roads])
                aid=('tree_oak_01','tree_poplar_01','tree_pine_01')[i%3]
                source=self.part(aid);radius=max(math.hypot(v.co.x,v.co.y) for v in source.vertices)
                height=self.entries[aid]['bounds']['max'][2]
                scale=min(allowed/radius,6.5/height)
                if scale<=0:raise ValueError('Existing grove tree has no valid crown clearance: '+prefix)
                obj=self.place(aid,(*q,.05),scale=(scale,)*3,feature_id=fid,role='grove_tree')
                obj['asset_kind']='tree';obj['grove_tree_index']=i
                for old in (trunk,crown):bpy.data.objects.remove(old,do_unlink=True)
                trees.append({'object':obj.name,'assetId':aid,'center':q,'clearanceRadius':allowed,'scale':scale})
                self.occupied.append((q,.25))
            rng=random.Random(stable_index('shrubs/'+fid,2**31));shrubs=[]
            for attempt in range(600):
                if len(shrubs)>=6:break
                q=(rng.uniform(min(p[0] for p in poly),max(p[0] for p in poly)),rng.uniform(min(p[1] for p in poly),max(p[1] for p in poly)))
                aid=('shrub_sage_01','shrub_berry_01')[len(shrubs)%2];source=self.part(aid)
                radius=max(math.hypot(v.co.x,v.co.y) for v in source.vertices);scale=.45+rng.random()*.25;r=radius*scale
                if not inside(q,poly) or boundary_distance(q,poly)<r+.05 or not self.clear(q,r):continue
                if any(math.dist(q,p)<r+rr+.10 for p,rr in self.occupied):continue
                obj=self.place(aid,(*q,.05),scale=(scale,)*3,feature_id=fid,role='grove_shrub');obj['asset_kind']='shrub'
                shrubs.append({'object':obj.name,'assetId':aid,'center':q,'scale':scale});self.occupied.append((q,r))
            record.update(status='authored_3d_kit',treeCount=len(trees),shrubCount=len(shrubs),
                          note='Source grove retained. Actual authored crowns fit the region and clear buildings/roads.')
            self.groves.append({'sourceFeatureId':fid,'trees':trees,'shrubs':shrubs})
        for record in stats.get('fountains',[]):
            fid=record['sourceId'];poly=[(p['x'],p['y']) for p in feature_by_id[fid]['points']];c=centroid(poly)
            base=bpy.data.objects[record['groundObject']]
            for obj in list(bpy.context.scene.objects):
                if obj.get('source_feature_id')==fid and obj is not base:bpy.data.objects.remove(obj,do_unlink=True)
            base['representation']='authored_kit_exact_footprint_base'
            radius=min(math.dist(c,p) for p in poly)
            # Radial warp uses the actual source boundary, including non-circular
            # outlines. The basin's outer ring never becomes an external circle.
            source=self.part('fountain_basin_01').copy()
            def boundary_radius(angle):
                direction=Vector((math.cos(angle),math.sin(angle)));best=float('inf')
                for a,b in zip(poly,poly[1:]+poly[:1]):
                    edge=Vector(b)-Vector(a);delta=Vector(a)-Vector(c)
                    determinant=direction.x*edge.y-direction.y*edge.x
                    if abs(determinant)<1e-9:continue
                    t=(delta.x*edge.y-delta.y*edge.x)/determinant
                    s=(delta.x*direction.y-delta.y*direction.x)/determinant
                    if t>0 and -1e-6<=s<=1+1e-6:best=min(best,t)
                if not math.isfinite(best):raise ValueError('Fountain source boundary is not star shaped about its center.')
                return best
            for vert in source.vertices:
                r=math.hypot(vert.co.x,vert.co.y)
                if r>1e-8:
                    factor=boundary_radius(math.atan2(vert.co.y,vert.co.x))/2
                    vert.co.x*=factor;vert.co.y*=factor
            obj=self.place('fountain_basin_01',(*c,.045),mesh=source,feature_id=fid,role='fitted_fountain_basin')
            objects=[base,obj]
            objects.append(self.place('fountain_ornament_01',(*c,.265),feature_id=fid,role='fountain_ornament'))
            objects.append(self.place('water_flow_01',(*c,.525),scale=(radius/2,radius/2,1),part='surface_and_ripples',feature_id=fid,role='fountain_water'))
            objects.append(self.place('water_flow_01',(*c,.525),part='water_jets',feature_id=fid,role='fountain_jets'))
            for obj in objects:obj['asset_kind']='fountain'
            record.update(status='authored_3d_kit',objects=[o.name for o in objects],
                          note='Exact source base plus authored carved rim, center ornament and separate static water meshes.')
            self.fountains.append({'sourceFeatureId':fid,'objects':[o.name for o in objects]})

    def replace_market(self,props,shop_stats,records):
        citizens=('walking','merchant','carrying','talking','guard','basket','elder','apprentice')
        visitors=sorted([o for o in bpy.context.scene.objects if o.get('asset_kind')=='person'],key=lambda o:o.name)
        bpy.context.view_layer.update()
        occupied=[];adjustments=[]
        def collider(mesh,matrix):
            points=[matrix@v.co for v in mesh.vertices]
            box=([min(p[i] for p in points) for i in range(3)],[max(p[i] for p in points) for i in range(3)])
            return box,BVHTree.FromPolygons(points,[list(p.vertices) for p in mesh.polygons])
        def overlaps(a,b):return all(a[0][i]<=b[1][i] and b[0][i]<=a[1][i] for i in range(3))
        for ob in bpy.context.scene.objects:
            if ob.type=='MESH' and ob.get('asset_kind') in ('market_stall','cargo','hand_cart','well','statue'):
                occupied.append(collider(ob.data,ob.matrix_world))
        for i,obj in enumerate(visitors):
            initial='citizen_'+citizens[i%8]+'_01';scale=float(obj.scale.x)*1.68/1.85
            chosen=None;original_yaw=obj.rotation_euler.z
            for yaw in (0,.18,-.18,.40,-.40,math.pi/2,-math.pi/2):
                for offset in range(8):
                    aid='citizen_'+citizens[(i+offset)%8]+'_01'
                    rotation=obj.rotation_euler.copy();rotation.z=original_yaw+yaw
                    matrix=Matrix.Translation(obj.location)@rotation.to_matrix().to_4x4()@Matrix.Diagonal((scale,scale,scale,1))
                    box,tree=collider(self.part(aid),matrix)
                    if any(overlaps(box,other_box) and tree.overlap(other_tree) for other_box,other_tree in occupied):continue
                    chosen=(aid,yaw,box,tree);break
                if chosen:break
            if not chosen:raise ValueError('No authored citizen pose fits the retained market position: '+obj.name)
            aid,yaw,box,tree=chosen
            obj.data=self.part(aid);obj.scale=(scale,)*3;obj.rotation_euler.z=original_yaw+yaw
            obj['authored_asset_id']=aid;obj['asset_mount_role']='citizen';obj['representation']='authored_3d_kit'
            occupied.append((box,tree))
            if aid!=initial or yaw:
                adjustments.append({'object':obj.name,'initialAsset':initial,'chosenAsset':aid,'yawAdjustmentRadians':yaw,'positionChanged':False})
            self.register(obj,aid,'citizen')
        props['citizenPoseAdjustments']=adjustments
        props['citizenAssetIds']=sorted({x['assetId'] for x in self.instances if x['role']=='citizen'})
        goods=('food','pottery','cloth','iron')
        for i,obj in enumerate(sorted([o for o in bpy.context.scene.objects if o.get('asset_kind')=='market_stall'],key=lambda o:o.name)):
            lo,hi=mesh_bounds(obj.data);width=hi[0]-lo[0]
            for j in range(2):
                aid='goods_'+goods[(i+j)%4]+'_01'
                p=obj.matrix_world@Vector(((j-.5)*width*.50,-.47,1.055))
                self.place(aid,p,scale=(.49,)*3,basis=obj.rotation_euler.to_matrix().to_4x4(),role='market_goods')
        lookup={r['id']:r for r in records}
        for shop in shop_stats.get('shop_positions',[]):
            recipe=shop['recipe'];origin=Vector((*shop['origin'],0));t=Vector((*shop['facade_direction'],0));n=Vector((*shop['outward'],0))
            basis=wall_basis(t,n);width=shop['width_m'];depth=shop['projection_m'];bid=shop['building_id']
            kind={'tavern':'pottery','bakery':'food','smith':'iron','draper':'cloth','cobbler':'cloth','potter':'pottery','grocer':'food','warehouse':'cloth'}[recipe]
            p=origin-t*(width*.10)+n*min(.70,depth*.57)+Vector((0,0,1.09))
            self.place('goods_'+kind+'_01',p,scale=(.42,)*3,basis=basis,building_id=bid,role='shop_goods')
            p=origin+t*(width*.29)+n*.14+Vector((0,0,min(lookup[bid]['eave']-.16,4.2)))
            for part in ('bracket_and_board','raised_icon'):
                self.place('sign_'+recipe+'_01',p,scale=(.62,)*3,basis=basis,part=part,pivot=(.62,.16,1.84),building_id=bid,role='shop_sign')
        props['authoredMarketGoodsMeshes']=sum(x['role']=='market_goods' for x in self.instances)
        props['authoredCitizenMeshes']=len(visitors)
        shop_stats['authoredGoodsMeshes']=sum(x['role']=='shop_goods' for x in self.instances)
        shop_stats['authoredSignMeshes']=sum(x['role']=='shop_sign' for x in self.instances)

    def mount_gates(self,mounts):
        seen=set()
        for i,mount in enumerate(mounts):
            key=(mount['wallId'],tuple(round(v,4) for v in mount['origin']))
            if key in seen:continue
            seen.add(key);width=mount['width'];along=mount['along'];normal=mount['normal']
            basis=wall_basis(along,normal);p=Vector((*mount['origin'],0))+Vector((*normal,0))*1.72
            sx=width/4;sz=1.25
            aid='gate_arch_trim_0'+str(1+i%2)
            objects=[self.place(aid,p,scale=(sx,1,sz),basis=basis,role='gate_trim')]
            for part in ('left_leaf_open','right_leaf_open','portcullis_raised','lamps'):
                objects.append(self.place('gate_hardware_01',(*mount['origin'],0),scale=(sx,1,sz),basis=basis,part=part,role='gate_hardware'))
            for obj in objects:
                obj['source_wall_id']=mount['wallId'];obj['source_gate_index']=mount['index'];obj['asset_kind']='gate_attachment'
            self.gate_mounts.append({**mount,'objects':[o.name for o in objects],
                                     'passageWidth':max(.2,width-1.0),'passageHeight':2.1})

    def ground_and_courtyard(self,data):
        for obj in bpy.context.scene.objects:
            if obj.name.startswith('Original_road_') or obj.name=='Original_market_square':
                mat='cobble' if obj.name=='Original_market_square' else 'earth'
                obj.data.materials.clear();obj.data.materials.append(self.materials[mat])
                if not obj.data.uv_layers:obj.data.uv_layers.new(name='MetreUV')
                for face in obj.data.polygons:
                    for li in face.loop_indices:
                        co=obj.data.vertices[obj.data.loops[li].vertex_index].co;obj.data.uv_layers.active.data[li].uv=(co.x,co.y)
                obj['authored_asset_id']='ground_'+mat+'_01';obj['asset_mount_role']='planned_ground_material'
                self.register(obj,'ground_'+mat+'_01','planned_ground_material')
        # New courtyard instances are designed decoration within existing land
        # regions, not new source buildings, walls or agricultural boundaries.
        blockers=[]
        for obj in bpy.context.scene.objects:
            kind=obj.get('asset_kind')
            if kind in ('person','market_stall','cargo','hand_cart','well','statue'):
                p=(obj.location.x,obj.location.y);radius={'person':.5,'market_stall':2.2,'cargo':.9,'hand_cart':2.1,'well':1.5,'statue':1.5}[kind]
                blockers.append((p,radius))
        for f in data.get('features',[]):
            if f['kind'] in ('fountain','grove'):
                poly=[(p['x'],p['y']) for p in f['points']];c=centroid(poly)
                blockers.append((c,max(math.dist(c,p) for p in poly)+.25))
        placed=Counter()
        for district in sorted(data['districts'],key=lambda d:d['id']):
            if district['wardType'] not in ('Farm','Park','Market'):continue
            poly=[(p['x'],p['y']) for p in district['points']];rng=random.Random(stable_index('courtyard/'+district['id'],2**31))
            aid='bench_01' if district['wardType'] in ('Park','Market') else ('fence_01' if stable_index(district['id'],2)==0 else 'firewood_01')
            if placed[aid]>=6:continue
            dims=self.entries[aid]['dimensions'];radius=math.hypot(dims[0],dims[1])*.5+.12
            for attempt in range(240):
                p=(rng.uniform(min(q[0] for q in poly),max(q[0] for q in poly)),rng.uniform(min(q[1] for q in poly),max(q[1] for q in poly)))
                if not inside(p,poly) or boundary_distance(p,poly)<radius+.05 or not self.clear(p,radius):continue
                if any(math.dist(p,q)<radius+r+.15 for q,r in blockers):continue
                obj=self.place(aid,(*p,.045),role='courtyard_decoration');obj['source_district_id']=district['id']
                obj['asset_kind']='courtyard_decoration';obj['source_semantic']=False
                blockers.append((p,radius));placed[aid]+=1;break

    def decorate(self,data,records,feature_stats,props,shop_stats,gate_mounts):
        self.replace_features(data,feature_stats)
        self.replace_market(props,shop_stats,records)
        self.mount_gates(gate_mounts)
        self.ground_and_courtyard(data)
        bpy.context.view_layer.update()
        return self.report()

    def report(self):
        used=Counter(r['assetId'] for r in self.instances);groups=Counter(r['gapId'] for r in self.instances)
        return {'schemaVersion':1,'enabled':True,'library':str(self.path),
                'librarySha256':hashlib.sha256(self.path.read_bytes()).hexdigest(),
                'availableVariants':len(self.entries),'usedVariants':len(used),'meshPlacements':len(self.instances),
                'groups':dict(sorted(groups.items())),'assets':dict(sorted(used.items())),
                'unusedAssetIds':sorted(set(self.entries)-set(used)),
                'buildingsWithAuthoredComponents':len({r['sourceBuildingId'] for r in self.instances if r['sourceBuildingId']}),
                'specialBuildings':self.special_buildings,'cathedralRoles':self.roles,
                'groves':self.groves,'fountains':self.fountains,'gates':self.gate_mounts,
                'instances':self.instances,'skippedMounts':self.skipped,
                'policy':'Preserve original ground footprints and roads. Roles and decoration are explicit design rules. Each placed mesh references an authored library asset; unsafe mounts are skipped.'}
