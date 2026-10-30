"""Exercise source ownership and shared reservations with real market meshes."""
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'experiments/3d-sample'))
from props import build_market, material, Mesh, make_object


def run():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    keys=('ink','timber','plaster','stone','stone_plain','roof_slate','roof_ochre',
          'canvas','canvas_cream','ground','road','metal','glass')
    mats={key:material('Multi-market test '+key,(.6,.5,.4)) for key in keys}
    markets={'a':[(-30.,-20.),(0.,-20.),(0.,20.),(-30.,20.)],
             'b':[(1.,-20.),(31.,-20.),(31.,20.),(1.,20.)]}
    features=[{'id':'statue-a','districtId':'a','kind':'statue','points':[(-16.,-1.),(-14.,-1.),(-14.,1.),(-16.,1.)]},
              {'id':'statue-b','districtId':'b','kind':'statue','points':[(15.,-1.),(17.,-1.),(17.,1.),(15.,1.)]}]
    shared=[{'center':[-15.,0.],'radius':math.sqrt(2)+.35,'marketId':'a','kind':'planned_feature','object':None},
            {'center':[16.,0.],'radius':math.sqrt(2)+.35,'marketId':'b','kind':'planned_feature','object':None}]
    records=[]
    for index,(mid,polygon) in enumerate(markets.items()):
        record=build_market(polygon,[],[],mats,seed=123+index,features=features,
            market_id=mid,shared_occupied=shared,
            other_market_polygons=[points for owner,points in markets.items() if owner!=mid])
        objects=[bpy.data.objects[name] for name in record['objectNames']]
        assert len(objects)==record['objects']==record['nativeObjectCount']
        assert all(o.get('source_market_id')==mid and mid in o.name for o in objects)
        assert record['statues']==1 and record['statue_planning_locations'][0]['feature_id']=='statue-'+mid
        assert record['people_market_clearance_verified'] and record['people_reserved_clearance_verified']
        assert record['stalls']>0 and record['people']>0 and record['capacityStatus']=='populated'
        records.append(record)
    tiny=build_market([(60.,0.),(60.5,0.),(60.5,6.),(60.,6.)],[],[],mats,
        seed=125,market_id='tiny',shared_occupied=shared,
        other_market_polygons=list(markets.values()))
    assert tiny['capacityStatus']=='empty' and tiny['emptyReason']
    assert tiny['objects']==tiny['nativeObjectCount']==len(tiny['objectNames'])==0
    # Independently intersect the actual saved transforms, not the circle ledger.
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('source_market_id')]
    bpy.context.view_layer.update()
    trees={};boxes={}
    for obj in objects:
        vertices=[obj.matrix_world@v.co for v in obj.data.vertices]
        trees[obj.name]=BVHTree.FromPolygons(vertices,[list(face.vertices) for face in obj.data.polygons])
        boxes[obj.name]=([min(v[i] for v in vertices) for i in range(3)],
                         [max(v[i] for v in vertices) for i in range(3)])
    conflicts=[]
    for i,obj in enumerate(objects):
        for other in objects[:i]:
            if obj.get('source_market_id')==other.get('source_market_id'):continue
            lo,hi=boxes[obj.name];ol,oh=boxes[other.name]
            if any(hi[j]<ol[j] or oh[j]<lo[j] for j in range(3)):continue
            if trees[obj.name].overlap(trees[other.name]):conflicts.append((obj.name,other.name))
    assert not conflicts,conflicts
    before=len(objects)
    try:
        build_market(markets['a'],[],[],mats,market_id='a',shared_occupied=shared)
        raise AssertionError('A duplicate source market was silently assembled twice.')
    except ValueError:pass
    assert len([o for o in bpy.context.scene.objects if o.get('source_market_id')])==before
    summary=[{'marketId':row['marketId'],'objects':row['objects'],'stalls':row['stalls'],'people':row['people'],
              'statues':row['statues'],'capacityStatus':row['capacityStatus']} for row in records]
    snapshots=[(o.name,o.get('source_market_id'),o.get('source_feature_id'),list(o.location),list(o.scale),list(o.rotation_euler)) for o in objects]
    return summary,hashlib.sha256(json.dumps(sorted(snapshots)).encode()).hexdigest()


first,digest=run()
second,repeated=run()
assert first==second and digest==repeated,'Repeated source IDs and seeds must retain each market layout.'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
mats={key:material('Structure market '+key,(.6,.5,.4)) for key in
      ('ink','timber','plaster','stone','stone_plain','roof_slate','roof_ochre',
       'canvas','canvas_cream','ground','road','metal','glass')}
wall_polygon=[(-8.,-20.),(-6.,-20.),(-6.,20.),(-8.,20.)]
wall_mesh=Mesh(mats);wall_mesh.box((-7.,0.,3.),(2.,40.,6.),'stone')
wall=make_object('Structure clearance test wall',wall_mesh.create_mesh('Test actual wall'),
                 (0.,0.),0,bpy.context.scene.collection,'test_wall')
reserved=build_market([(-30.,-20.),(0.,-20.),(0.,20.),(-30.,20.)],[],[],mats,
                     seed=123,market_id='wall-side',structure_polygons=[wall_polygon])
bpy.context.view_layer.update()
def tree(obj):return BVHTree.FromPolygons([obj.matrix_world@v.co for v in obj.data.vertices],
                                         [list(face.vertices) for face in obj.data.polygons])
wall_tree=tree(wall)
structure_conflicts=[name for name in reserved['objectNames'] if tree(bpy.data.objects[name]).overlap(wall_tree)]
assert not structure_conflicts,structure_conflicts
assert reserved['reserved_structure_count']==1 and reserved['people_structure_clearance_verified']
assert reserved['stalls']>0 and reserved['people']>0
output=ROOT/'artifacts/multi-market-props-test'
output.mkdir(parents=True,exist_ok=True)
(output/'verification.json').write_text(json.dumps({'passed':True,'markets':first,'crossMarketMeshConflicts':[],
    'repeatLayoutSha256':digest,'structureClearance':{'stalls':reserved['stalls'],'people':reserved['people'],
        'actualTriangleConflicts':structure_conflicts},'checks':['owned object counts','unique source IDs','feature ownership','explicit empty small-market capacity',
    'static props and people clear actual wall triangles',
    'other market people exclusion','cross-market real mesh intersections','duplicate assembly rejected','repeat determinism']},indent=2),encoding='utf-8')
print('PASS multi-market props',json.dumps(first),flush=True)
