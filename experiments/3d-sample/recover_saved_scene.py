"""Recover a saved city from a matching snapshot, fixing clipped roof meshes.

The source plan, buildings, roads, and wall geometry are never regenerated.
Independent verification is required before the caller renders this scene.
"""
import argparse,json,sys,shutil
from pathlib import Path
import bpy
from mathutils import Matrix
sys.path.insert(0,str(Path(__file__).resolve().parent))
from fitted_mesh import fit_mesh
from props import inside,boundary_distance

parser=argparse.ArgumentParser()
parser.add_argument('--source-dir',type=Path,required=True)
parser.add_argument('--artifact-dir',type=Path,required=True)
parser.add_argument('--name',default='scene')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
old=args.source_dir.resolve();out=args.artifact_dir.resolve()
source=json.loads((old/'source-town.json').read_text(encoding='utf-8-sig'))
current=json.loads((out/'source-town.json').read_text(encoding='utf-8-sig'))
if source!=current:raise ValueError('Saved scene recovery requires an identical source planning snapshot.')
manifest=json.loads((old/'scene-manifest.json').read_text(encoding='utf-8-sig'))
records={r['id']:r for r in manifest['buildings']}
bpy.ops.wm.open_mainfile(filepath=str(old/'scene.blend'))
repaired=[]
for obj in list(bpy.context.scene.objects):
    if obj.get('asset_mount_role')!='footprint_fitted_roof':continue
    poly=records[obj['source_building_id']]['footprint']
    outside=lambda p:not inside((p.x,p.y),poly) and boundary_distance((p.x,p.y),poly)>5e-5
    bad=[obj.matrix_world@v.co for v in obj.data.vertices if outside(obj.matrix_world@v.co)]
    if not bad:continue
    count=len(obj.data.vertices)
    obj.data=fit_mesh(obj.data,obj.matrix_world,poly,obj.name+' / precision repaired')
    obj.matrix_world=Matrix.Identity(4)
    bpy.context.view_layer.update()
    if any(outside(obj.matrix_world@v.co) for v in obj.data.vertices):raise ValueError('Recovered roof still exceeds its source footprint: '+obj.name)
    repaired.append({'object':obj.name,'buildingId':obj['source_building_id'],'outsideVerticesBefore':len(bad),
                     'maximumOutsideDistanceBefore':max(boundary_distance((p.x,p.y),poly) for p in bad),
                     'verticesBefore':count,'verticesAfter':len(obj.data.vertices),'outsideVerticesAfter':0})
manifest['recovery']={'sourceDirectory':str(old),'method':'float64 footprint clipping; unchanged source plan and other meshes','repairedRoofs':repaired}
(out/'scene-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
if (old/'asset-integration.json').is_file():shutil.copy2(old/'asset-integration.json',out/'asset-integration.json')
(out/'scene-recovery.json').write_text(json.dumps(manifest['recovery'],indent=2),encoding='utf-8')
bpy.context.scene['recovered_from_snapshot']=str(old)
bpy.context.scene.render.filepath=str(out/(args.name+'-render.png'))
helper=bpy.data.texts.get('render_pipeline.py')
if helper:helper.clear();helper.write((Path(__file__).resolve().parent/'render_pipeline.py').read_text(encoding='utf-8'))
bpy.ops.wm.save_as_mainfile(filepath=str(out/(args.name+'.blend')))
print('RECOVERED_SCENE_READY '+json.dumps({'roofs':repaired,'buildings':len(records)}),flush=True)
