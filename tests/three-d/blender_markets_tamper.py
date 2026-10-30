"""Reject missing, misattributed and colliding saved market geometry."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import sys

import bpy

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'experiments/3d-sample'))
from verify_markets import verify_markets

parser=argparse.ArgumentParser()
parser.add_argument('--artifact-dir',type=Path,default=ROOT/'artifacts/3d-multi-market-town')
parser.add_argument('--blend',type=Path)
parser.add_argument('--self-test',action='store_true')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
out=args.artifact_dir.resolve()
blend=args.blend.resolve() if args.blend else out/'scene.blend'
selection=manifest=template=None
scale=1.


def box(name,center,dimensions,kind,mid):
    x,y,z=center;dx,dy,dz=[d/2 for d in dimensions]
    vertices=[(x+a*dx,y+b*dy,z+c*dz) for a,b,c in
              ((-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1))]
    faces=[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(obj)
    obj['asset_kind']=kind;obj['source_market_id']=mid
    return obj


def synthetic():
    global selection,manifest,scale
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    selection={'scope':'whole-city','districts':[],'features':[],'plazas':[]}
    manifest={'horizontalScale':1.,'markets':{'enabled':True,'version':1,'propsEnabled':True,'plazas':[]}}
    scale=1.
    for i,x in enumerate((0.,35.)):
        mid='market'+str(i)
        points=[{'x':x+a,'y':b} for a,b in ((0,0),(30,0),(30,25),(0,25))]
        selection['districts'].append({'id':mid,'wardType':'Market','points':points})
        selection['plazas'].append({'id':mid,'points':points})
        ground=box('Original_market_square_'+mid,(x+15,12.5,.015),(30,25,.02),'market_plaza',mid)
        ground['source_district_id']=mid
        stall=box('Market stall '+mid,(x+10,7,1),(3,2,2),'market_stall',mid)
        visitor=box('Market visitor '+mid,(x+18,13,1),(.6,.6,2),'person',mid)
        props={'stalls':1,'people':1,'well':0,'cart':0,'cargo_groups':0,'statues':0,
               'objects':2,'capacityStatus':'populated'}
        manifest['markets']['plazas'].append({'id':mid,'groundObject':ground.name,
            'props':props,'objects':[stall.name,visitor.name]})
    selection['plaza']=selection['plazas'][0]
    wall=box('Synthetic_city_wall',(80,12.5,3),(4,25,6),'fortification',None)
    del wall['source_market_id'];wall['source_wall_id']='synthetic-wall'
    collection=bpy.data.collections.get('02_CITY_WALL')
    if collection is None:
        collection=bpy.data.collections.new('02_CITY_WALL');bpy.context.scene.collection.children.link(collection)
    collection.objects.link(wall)


def reload_scene():
    global manifest
    if args.self_test:
        synthetic()
    else:
        bpy.ops.wm.open_mainfile(filepath=str(blend))
        manifest=copy.deepcopy(template)


def rows():
    return manifest['markets']['plazas']


def contents(row):
    return [bpy.data.objects[name] for name in row['objects'] if name in bpy.data.objects]


def verify():
    bpy.context.view_layer.update()
    return verify_markets(selection,manifest,scale)


def missing_ground():
    bpy.data.objects.remove(bpy.data.objects[rows()[1]['groundObject']],do_unlink=True)


def changed_ground():
    bpy.data.objects[rows()[1]['groundObject']].location.x+=2.


def wrong_owner():
    candidates=contents(rows()[1])
    if not candidates:raise AssertionError('Second market requires contents for the ownership test.')
    candidates[0]['source_market_id']=rows()[0]['id']


def missing_contents():
    candidates=contents(rows()[1])
    if not candidates:raise AssertionError('Second market requires contents for the missing-props test.')
    for obj in candidates:
        bpy.data.objects.remove(obj,do_unlink=True)


def omitted_contents_manifest():
    rows()[1]['objects']=[]


def overlapping_markets():
    first,second=contents(rows()[0]),contents(rows()[1])
    for kind in ('market_stall','person','cargo','hand_cart'):
        a=next((obj for obj in first if obj.get('asset_kind')==kind),None)
        b=next((obj for obj in second if obj.get('asset_kind')==kind),None)
        if a and b:
            b.data=a.data;b.matrix_world=a.matrix_world.copy()
            return
    raise AssertionError('Both markets need a common populated prop category for the collision test.')


def unplanned_market():
    source=bpy.data.objects[rows()[1]['groundObject']]
    obj=source.copy();obj.data=source.data.copy();obj.name='Original_market_square_unplanned'
    bpy.context.scene.collection.objects.link(obj)
    obj['source_market_id']='unplanned';obj['source_district_id']='unplanned'


def market_inside_fortification():
    targets=[obj for row in rows() for obj in contents(row) if obj.get('asset_kind')=='person']
    if not targets:targets=[obj for row in rows() for obj in contents(row) if obj.get('asset_kind')=='market_stall']
    collection=bpy.data.collections.get('02_CITY_WALL')
    candidates={obj.name:obj for obj in collection.all_objects if obj.type=='MESH'} if collection else {}
    candidates.update({obj.name:obj for obj in bpy.context.scene.objects if obj.type=='MESH' and obj.get('source_wall_id')})
    def bound(obj):
        vertices=[obj.matrix_world@vertex.co for vertex in obj.data.vertices]
        return ([min(p[i] for p in vertices) for i in range(3)],
                [max(p[i] for p in vertices) for i in range(3)])
    candidates=[obj for obj in candidates.values() if len(obj.data.polygons)>0]
    if not candidates or not targets:raise AssertionError('A populated market and actual wall/tower are required.')
    candidates.sort(key=lambda obj:(bool(obj.get('source_tower_vertex_id')),
                    min(bound(obj)[1][i]-bound(obj)[0][i] for i in (0,1))*(bound(obj)[1][2]-bound(obj)[0][2])),reverse=True)
    target=targets[0];low,high=bound(candidates[0]);old_low,old_high=bound(target)
    destination=[(low[0]+high[0])/2,(low[1]+high[1])/2,low[2]+min(2.,(high[2]-low[2])*.5)]
    for i in range(3):target.matrix_world.translation[i]+=destination[i]-(old_low[i]+old_high[i])/2


if not args.self_test:
    selection=json.loads((out/'selection.json').read_text(encoding='utf-8-sig'))
    template=json.loads((out/'scene-manifest.json').read_text(encoding='utf-8-sig'))
    scale=template['horizontalScale']
reload_scene()
baseline=verify()
if not baseline['passed']:
    raise AssertionError('Baseline markets must pass: '+json.dumps(baseline['failures']))
if len(rows())<2:
    raise AssertionError('A multi-market sample requires at least two source markets.')
cases=[('missing_second_ground',missing_ground,'separately identified market ground'),
       ('changed_second_footprint',changed_ground,'actual market footprint'),
       ('wrong_market_ownership',wrong_owner,'contents list'),
       ('missing_second_market_contents',missing_contents,'count differs'),
       ('omitted_second_contents_record',omitted_contents_manifest,'contents list'),
       ('cross_market_overlap',overlapping_markets,'different markets intersect'),
       ('unplanned_market_ground',unplanned_market,'market ground count'),
       ('market_contents_inside_fortification',market_inside_fortification,'intersect city or castle fortifications')]
checks=[]
for name,mutate,expected in cases:
    reload_scene();mutate();report=verify()
    rejected=not report['passed'] and any(expected in failure for failure in report['failures'])
    checks.append({'kind':name,'rejected':rejected,'failures':report['failures']})
    if not rejected:
        raise AssertionError(name+' was accepted or failed for another reason: '+json.dumps(report['failures']))
result={'passed':True,'baselinePassed':True,'checks':checks,'selfTest':args.self_test}
if not args.self_test:
    result.update(scene=str(blend),sourceFilesSha256={path.name:hashlib.sha256(path.read_bytes()).hexdigest()
        for path in (blend,out/'source-town.json',out/'selection.json',out/'scene-manifest.json')})
    (out/'markets-tamper-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('PASS market corruptions: '+', '.join(row['kind'] for row in checks))
