"""Clip a library or saved mesh to exact planning coordinates, retaining UVs."""
import bpy
import bmesh
from mathutils import Vector
from mathutils.geometry import tessellate_polygon
from footprint_geometry import signed_area, clip_face
FIT_STATS={'calls':0,'uncut':0}


def fit_mesh(source, matrix, polygon, name='Roof fitted to source'):
    FIT_STATS['calls']+=1
    poly=list(polygon) if signed_area(polygon)>0 else list(reversed(polygon))
    turns=[(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]) for a,b,c in zip(poly,poly[1:]+poly[:1],poly[2:]+poly[:2])]
    coefficients=tuple(tuple(float(matrix[k][j]) for j in range(4)) for k in range(3))
    coordinates=[tuple(float(x) for x in vertex.co) for vertex in source.vertices]
    transformed=[tuple(sum(coefficients[k][j]*co[j] for j in range(3))+coefficients[k][3] for k in range(3)) for co in coordinates]
    # Convex containment proves that clipping cannot change any face. Retain
    # the original face rebuilding/welding order: copying source quads directly
    # can choose a different diagonal on a non-planar authored polygon.
    uncut=min(turns)>=0 and all((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])>=-1e-10
                              for p in transformed for a,b in zip(poly,poly[1:]+poly[:1]))
    if uncut:FIT_STATS['uncut']+=1
    if min(turns)>=-1e-7:boundaries=[poly]
    else:
        vectors=[Vector((*p,0)) for p in poly]
        def original(v):
            index=v if isinstance(v,int) else min(range(len(vectors)),key=lambda i:(vectors[i]-v).length_squared)
            return poly[index]
        boundaries=[[original(v) for v in triangle] for triangle in tessellate_polygon([vectors])]
    vertices=[];faces=[];uvs=[];indices=[]
    uv_layer=source.uv_layers.active
    for face in source.polygons:
        initial=[]
        for li in face.loop_indices:
            xyz=transformed[source.loops[li].vertex_index]
            uv=tuple(uv_layer.data[li].uv) if uv_layer else (0,0)
            initial.append((*xyz,*uv))
        for boundary in boundaries:
            points=initial[:] if uncut else clip_face(initial[:],boundary)
            cleaned=[]
            for p in points:
                if not cleaned or sum((p[k]-cleaned[-1][k])**2 for k in range(3))>1e-14:cleaned.append(p)
            if len(cleaned)>2 and sum((cleaned[0][k]-cleaned[-1][k])**2 for k in range(3))<1e-14:cleaned.pop()
            if len(cleaned)<3:continue
            offset=len(vertices);vertices.extend(p[:3] for p in cleaned)
            faces.append(tuple(range(offset,offset+len(cleaned))));uvs.append([p[3:] for p in cleaned]);indices.append(face.material_index)
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces)
    for material in source.materials:mesh.materials.append(material)
    layer=mesh.uv_layers.new(name='ST_uv_meters')
    for face,coords,slot in zip(mesh.polygons,uvs,indices):
        face.material_index=slot
        for li,uv in zip(face.loop_indices,coords):layer.data[li].uv=uv
    mesh.update();bm=bmesh.new();bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-7)
    bm.to_mesh(mesh);bm.free();mesh.update()
    return mesh
