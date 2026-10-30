"""Regression for the near-collinear 80-district cathedral footprint."""
import json,math,sys
from pathlib import Path
import bpy
from mathutils import Matrix,Vector
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'experiments/3d-sample'))
from asset_integration import AssetLibrary
from props import inside,boundary_distance

poly=[(55.44544596605287,40.099983715602455),(62.15198114811889,65.1782084833529),
      (50.31792763262317,51.22722474331727),(50.300889418009554,51.20725967332989),
      (-12.747987830712141,-22.227562909260996),(.08565719872778033,-24.769609859268634)]
u=Vector((-.6514149904251099,-.7587215900421143));across=Vector((u.y,-u.x))
us=[Vector(p).dot(u) for p in poly];xs=[Vector(p).dot(across) for p in poly]
width,length=max(xs)-min(xs),max(us)-min(us);c=u*((max(us)+min(us))/2)+across*((max(xs)+min(xs))/2)
basis=Matrix(((across.x,u.x,0,c.x),(across.y,u.y,0,c.y),(0,0,1,10.4),(0,0,0,1)))
matrix=basis@Matrix.Diagonal((width/6,length/8,min(width*.53,8)/3,1))
lib=AssetLibrary();mesh=lib.fitted_mesh('cathedral_roof_01','roof_and_cornice',matrix,poly)
bad=[v for v in mesh.vertices if not inside((v.co.x,v.co.y),poly) and boundary_distance((v.co.x,v.co.y),poly)>5e-5]
assert not bad,len(bad)
assert len(mesh.polygons)>0 and mesh.uv_layers.active is not None
assert all(math.isfinite(x) for v in mesh.vertices for x in v.co)
print('FITTED_MESH_REGRESSION '+json.dumps({'passed':True,'vertices':len(mesh.vertices),'faces':len(mesh.polygons),'outsideVertices':len(bad)}),flush=True)
