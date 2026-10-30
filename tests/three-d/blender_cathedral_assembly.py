"""Real authored kit on the reported wedge church and an unlabelled old church.
Run in a separate background Blender. Keeps all source ground rings intact.
"""
import bpy
import json
import math
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'experiments'/'3d-sample'))
from asset_integration import AssetLibrary
from verify_integrated_assets import verify_assets
from footprint_geometry import compare_footprints

town=json.loads((ROOT/'artifacts'/'church-layout-fix'/'town-80.json').read_text(encoding='utf-8'))
vertices={v['id']:v for v in town['vertices']}
church=next(d for d in town['districts'] if d['wardType']=='Cathedral')
buildings=[dict(b,wardType='Cathedral',points=[vertices[v] for v in b['boundary']])
           for b in town['buildings'] if b['districtId']==church['id']]
# Old JSON remains on the old inference path and needs no new metadata.
for bid,poly in [('old-hall',[(200,0),(220,0),(220,48),(200,48)]),
                 ('old-tower',[(220,0),(232,0),(232,12)] + [(220,12)])]:
    buildings.append({'id':bid,'districtId':'old','wardType':'Cathedral','points':[{'x':x,'y':y} for x,y in poly]})
selection={'buildings':buildings,'districts':[],'roads':[],'walls':[],'features':[]}
for obj in list(bpy.data.objects):bpy.data.objects.remove(obj,do_unlink=True)
records=[]
for b in buildings:
    bid=b['id'];poly=[(p['x']*.5,p['y']*.5) for p in b['points']]
    edges=[(c[0]-a[0],c[1]-a[1]) for a,c in zip(poly,poly[1:]+poly[:1])]
    edge=max(edges,key=lambda e:math.hypot(*e));length=math.hypot(*edge);u=(edge[0]/length,edge[1]/length)
    facades=[]
    for a,c in zip(poly,poly[1:]+poly[:1]):
        length=math.dist(a,c);facades.append({'a':a,'b':c,'length':length,'out':((c[1]-a[1])/length,-(c[0]-a[0])/length),'exposed':True,'streetFacing':False})
    r={'id':bid,'districtId':b['districtId'],'wardType':'Cathedral','footprint':poly,
       'eave':8,'facades':facades,'roofAxes':{'along':u,'across':(u[1],-u[0])}}
    if b.get('architecturalRole'):r['architecturalRole']=b['architecturalRole']
    records.append(r)
    mesh=bpy.data.meshes.new(bid);mesh.from_pydata([(*p,.08) for p in poly],[],[tuple(range(len(poly)))])
    wall=bpy.data.objects.new(bid+'_footprint_wall',mesh);bpy.context.scene.collection.objects.link(wall)
    wall['source_building_id']=bid;wall['source_district_id']=b['districtId']
lib=AssetLibrary();lib.architecture(selection,records)
result=verify_assets(selection,{'buildings':records,'assetIntegration':lib.report()},.5)
for r in records:
    wall=bpy.data.objects[r['id']+'_footprint_wall']
    ground=[wall.matrix_world@v.co for v in wall.data.vertices if abs(v.co.z-.08)<1e-5]
    assert compare_footprints(r['footprint'],[(p.x,p.y) for p in ground],1,2e-5)['passed']
roles=lib.roles
assert all(r['sourceSemantic']==(r['districtId']!='old') for r in roles)
assert next(r for r in roles if r['buildingId']=='old-hall')['role']=='main_hall'
assert next(r for r in roles if r['buildingId']=='old-tower')['role']=='bell_tower'
for invalid in [
    [{'id':'a','districtId':'bad','wardType':'Cathedral','architecturalRole':'main_hall'}],
    [{'id':'a','districtId':'bad','wardType':'Cathedral','architecturalRole':'main_hall'},
     {'id':'b','districtId':'bad','wardType':'Cathedral'}],
]:
    try:lib.design_roles(invalid)
    except ValueError:pass
    else:raise AssertionError('Partial role metadata must fail explicitly')
report={'passed':result['passed'],'roles':roles,'checks':['actual authored roof and belfry meshes',
        'explicit 2D roles preserved','legacy role inference retained','square tower and rectangular parts',
        'exact ground footprints','roof containment','facade separation','invalid partial roles rejected'],
        'failures':result['failures']}
(ROOT/'artifacts'/'church-layout-fix'/'assembly-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report),flush=True)
assert result['passed'],result['failures']
