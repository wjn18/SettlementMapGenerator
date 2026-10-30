"""Exercise real kit meshes on small, skewed, concave and legacy castle plans.

Run with an empty background Blender; no render is needed for this regression.
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

for obj in list(bpy.data.objects):bpy.data.objects.remove(obj,do_unlink=True)
cases=[('regular',0,[(-6,-8),(6,-8),(6,8),(-6,8)]),
       ('small',40,[(-3,-4),(3,-4),(3,4),(-3,4)]),
       ('skewed',80,[(-7,-9),(6,-7),(9,10),(-5,8)]),
       ('concave',130,[(-8,-10),(8,-10),(8,3),(3,3),(3,10),(-8,10)]),
       ('legacy',185,[(-6,-8),(6,-8),(6,8),(-6,8)]),
       ('legacy',208,[(-4,-5),(4,-5),(4,5),(-4,5)])]
records=[];selection={'buildings':[],'districts':[],'roads':[],'features':[],'walls':[]}
for i,(district,offset,original) in enumerate(cases):
    bid='test'+str(i);poly=[(x+offset,y) for x,y in original]
    faces=[]
    for a,b in zip(poly,poly[1:]+poly[:1]):
        length=math.dist(a,b);faces.append({'a':a,'b':b,'length':length,'out':((b[1]-a[1])/length,-(b[0]-a[0])/length),'exposed':True,'streetFacing':False})
    r={'id':bid,'districtId':district,'wardType':'Castle','footprint':poly,'eave':8,'facades':faces,'roofAxes':{'along':[0,1],'across':[1,0]},
       'roofPieces':[{'polygon':poly,'planes':[(0,0,8)],'lo':min(y for x,y in poly),'hi':max(y for x,y in poly)}]}
    records.append(r)
    mesh=bpy.data.meshes.new(bid);mesh.from_pydata([(*p,.08) for p in poly],[],[tuple(range(len(poly)))])
    wall=bpy.data.objects.new(bid+'_footprint_wall',mesh);bpy.context.scene.collection.objects.link(wall)
    wall['source_building_id']=bid;wall['source_district_id']=district
    selection['buildings'].append({'id':bid,'districtId':district,'wardType':'Castle','points':[{'x':x,'y':y} for x,y in poly]})
    selection['districts'].append({'id':district,'points':[{'x':x,'y':y} for x,y in poly]})
lib=AssetLibrary();lib.architecture(selection,records)
manifest={'buildings':records,'assetIntegration':lib.report()}
result=verify_assets(selection,manifest,1)
for r in records:
    wall=bpy.data.objects[r['id']+'_footprint_wall'];points=[wall.matrix_world@v.co for v in wall.data.vertices if abs(v.co.z-.08)<1e-5]
    assert len(points)==len(r['footprint'])
    assert all(min(math.hypot(p.x-q[0],p.y-q[1]) for p in points)<2e-5 for q in r['footprint'])
assert sum(r['architecturalRole']=='keep' for r in records)==5
assert records[-1]['architecturalRole']=='service_hall'
report={'passed':result['passed'],'cases':[{'buildingId':r['id'],'district':r['districtId'],'role':r['architecturalRole'],
        'corners':len(r['footprint']),'turrets':len(r['castleLayout']['turrets'])} for r in records],
        'checks':['real library meshes','exact ground rings','upper-component footprint containment','sparse castle-specific fittings',
                  'one keep per district and lower legacy annex','roof support and roof/turret separation','asset provenance and library hashes'],
        'failures':result['failures']}
(ROOT/'artifacts'/'castle-assets'/'assembly-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False),flush=True)
assert result['passed'],result['failures']
