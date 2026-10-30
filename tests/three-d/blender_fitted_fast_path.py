"""Compare fast uncut meshes and fallback clipping against the old fitter."""
import bpy,sys,importlib.util,math,json
from pathlib import Path
from mathutils import Matrix,Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'experiments'/'3d-sample'))
from asset_integration import AssetLibrary
from fitted_mesh import fit_mesh,FIT_STATS
spec=importlib.util.spec_from_file_location('reference_fitter',Path(__file__).with_name('reference_fitted_mesh.py'))
reference=importlib.util.module_from_spec(spec);spec.loader.exec_module(reference)
lib=AssetLibrary();source=lib.part('roof_ridge_eave_01',subset='ridge')
transform=Matrix.Translation((3,-4,5))@Matrix.Rotation(.37,4,'Z')@Matrix.Diagonal((1,2,1,1))
cases=[('uncut',[(-100,-100),(100,-100),(100,100),(-100,100)]),
       ('clipped',[(-2,-6),(4,-6),(4,4),(-2,4)]),
       ('concave',[(-10,-10),(10,-10),(10,0),(0,0),(0,10),(-10,10)])]
results=[]
for label,poly in cases:
    before=FIT_STATS['uncut'];old=reference.fit_mesh(source,transform,poly,'reference');new=fit_mesh(source,transform,poly,'optimized')
    trees=[BVHTree.FromPolygons([v.co for v in mesh.vertices],[list(f.vertices) for f in mesh.polygons]) for mesh in (old,new)]
    errors=[]
    for mesh,tree in zip((old,new),reversed(trees)):
        mesh.calc_loop_triangles()
        samples=[v.co for v in mesh.vertices]+[sum((mesh.vertices[i].co for i in face.vertices),Vector())/3 for face in mesh.loop_triangles]
        for p in samples:
            hit=tree.find_nearest(p);assert hit and hit[0] is not None;errors.append(hit[3])
        assert mesh.uv_layers.active and all(math.isfinite(x) for u in mesh.uv_layers.active.data for x in u.uv)
    maximum=max(errors,default=0)
    def canonical(mesh):
        faces=[];uv=mesh.uv_layers.active
        for face in mesh.polygons:
            cycle=[tuple(round(float(x),6) for x in (*mesh.vertices[mesh.loops[i].vertex_index].co,*uv.data[i].uv)) for i in face.loop_indices]
            faces.append((face.material_index,min(tuple(cycle[i:]+cycle[:i]) for i in range(len(cycle)))))
        return sorted(faces)
    # BMesh may rotate the starting corner of a non-planar quad, which changes
    # its implicit diagonal. Compare authored polygons and UVs independent of
    # that starting corner, rather than assuming a fixed triangulation.
    assert canonical(old)==canonical(new),label
    if label=='uncut':assert FIT_STATS['uncut']==before+1
    else:assert FIT_STATS['uncut']==before
    results.append({'case':label,'authoredPolygonsAndUVsEqual':True,'triangulationSurfaceDistance':maximum,'referenceVertices':len(old.vertices),'optimizedVertices':len(new.vertices)})
report={'passed':True,'cases':results,'stats':FIT_STATS}
(ROOT/'artifacts'/'3d-performance'/'fitted-mesh-tests.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report),flush=True)
