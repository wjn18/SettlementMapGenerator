"""Source-faithful inland river terrain and raised stone arch crossings."""
import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector
from river_geometry import plan_river, triangulate, signed_area

LIBRARY = Path(__file__).resolve().parents[2] / 'artifacts/river-assets/river-asset-library.blend'


def load_river_library(lib):
    if lib is None:
        raise ValueError('Inland rivers require the authored town and river libraries.')
    metadata = LIBRARY.with_name('asset-library.json')
    if not LIBRARY.is_file() or not metadata.is_file():
        raise FileNotFoundError('Build build_river_assets.py before generating a river city.')
    manifest = json.loads(metadata.read_text(encoding='utf-8'))
    if manifest['materialSlots'] != lib.slots:
        raise ValueError('River kit material slots differ from the town library.')
    entries = {entry['id']: entry for entry in manifest['assets']}
    with bpy.data.libraries.load(str(LIBRARY), link=False) as (available, target):
        if set(entries) - set(available.collections):
            raise ValueError('River kit collections are incomplete.')
        target.collections = list(entries)
    lib.entries.update(entries)
    lib.collections.update({collection.name: collection for collection in target.collections})
    lib.additional_libraries.append({'kitId': 'river_kit', 'library': str(LIBRARY),
        'sha256': hashlib.sha256(LIBRARY.read_bytes()).hexdigest(),
        'manifestSha256': hashlib.sha256(metadata.read_bytes()).hexdigest()})


def build_river(source, api, lib, scale, plan=None):
    if plan is None:
        if source.get('terrain',{}).get('coast'):
            from estuary_geometry import plan_estuary
            plan=plan_estuary(source,scale)
        else:
            plan=plan_river(source, scale)
    load_river_library(lib)
    mesh, extrude = api['mesh'], api['extrude']
    coll = api['collection']('09_RIVER')
    ground_bottom = plan['bedLevel'] - .4
    result = {'enabled': True, 'version': 2, 'waterLevel': plan['waterLevel'],
        'bedLevel': plan['bedLevel'], 'roadTop': plan['roadTop'],
        'waterObject': 'River_water_surface', 'bedObject': 'River_bed',
        'landObjects': [], 'bankObjects': [], 'bridges': [],
        'horizontalScale': scale, 'bankPolicy': plan.get('bankPolicy', []),
        'policy': 'Original river surface and bridge XY retained; raised stone arches join the bank road datum, with open central spans. Static geometry, no vessel movement simulation.'}
    for i, ring in enumerate(plan['flatLand']):
        ground = extrude('River_land_'+str(i), ring, ground_bottom, 0, api['M']['ground'], '00_GROUND')
        ground['environment_extent'] = True
        ground['source_terrain_role'] = 'river_land'
        result['landObjects'].append(ground.name)
    bed = extrude('River_bed', plan['water'], ground_bottom, plan['bedLevel'], lib.materials['earth'], '09_RIVER')
    bed['source_terrain_role'] = 'river_bed'; bed['environment_extent'] = True
    water = mesh('River_water_surface', [(x, y, plan['waterLevel']) for x, y in plan['water']],
                 triangulate(plan['water']), lib.materials['water'], '09_RIVER')
    water['source_terrain_role'] = 'river_water'; water['water_level'] = plan['waterLevel']
    water['environment_extent'] = True;water['terrain_water_layer']=True
    water['water_body']='river';water['water_layer']='surface'
    if source.get('terrain',{}).get('coast'):
        result['estuaryClipped']=True
        result['estuary']={'enabled':True,'version':1,'sourceCoastSide':source['terrain']['coast']['side'],
            'riverWaterObject':water.name,'seaWaterObject':'Harbor_sea_surface',
            'landObjects':result['landObjects'],'bankObjects':result['bankObjects'],
            'mouthSegments':plan['mouthSegments'],'mouthIntersections':plan.get('mouthIntersections',[]),
            'mouthCoastChain':plan.get('mouthCoastChain',[]),
            'coastDrySegments':plan['coastDrySegments'],
            'policy':'Sea retains its source domain; river water is the exact landward remainder; no quay crosses the mouth.'}
    from river_harbor_geometry import bank_height, river_docks
    docks=river_docks(source)
    for i, (shore, outer) in enumerate(zip(plan['shores'], plan['bankOuter'])):
        vertices=[]; shared={}; shell={}
        def vertex(point):
            key=tuple(round(v,8) for v in point)
            if key not in shared:shared[key]=len(vertices);vertices.append(point)
            return shared[key]
        def face(indices):
            # Shared side walls are internal construction faces. Cancel them
            # instead of keeping coplanar shells inside the terrain volume.
            cleaned=[]
            for index in indices:
                if not cleaned or cleaned[-1]!=index:cleaned.append(index)
            if cleaned and cleaned[-1]==cleaned[0]:cleaned.pop()
            if len(set(cleaned))<3:return
            origin=Vector(vertices[cleaned[0]])
            normal=sum(((Vector(vertices[a])-origin).cross(Vector(vertices[b])-origin)
                        for a,b in zip(cleaned[1:],cleaned[2:])),Vector())
            if normal.length<1e-10:return
            indices=cleaned
            key=tuple(sorted(indices))
            if key in shell:del shell[key]
            else:shell[key]=tuple(indices)
        for a, b, c, d in zip(shore, shore[1:], outer, outer[1:]):
            if max(math.dist(a, c), math.dist(b, d)) < 1e-7:
                continue
            top_points=[(c[0], c[1], 0), (d[0], d[1], 0),
                        (b[0], b[1], bank_height(b,docks,scale,plan['waterLevel']-.06)), (a[0], a[1], bank_height(a,docks,scale,plan['waterLevel']-.06))]
            if signed_area([p[:2] for p in top_points])<0:top_points.reverse()
            top=[vertex(p) for p in top_points]
            bottom=[vertex((p[0],p[1],ground_bottom)) for p in top_points]
            face(top);face(list(reversed(bottom)))
            for j in range(4):
                k=(j+1)%4
                face((top[k],top[j],bottom[j],bottom[k]))
        if vertices:
            bank=mesh('River_bank_'+str(i), vertices, list(shell.values()), lib.materials['earth'], '09_RIVER')
            bank['source_terrain_role']='river_bank';bank['environment_extent']=True
            bank['authored_asset_id']='river_bank_profile_01';bank['asset_mount_role']='river_bank'
            bank['representation']='source_fitted_profile'
            lib.register(bank,'river_bank_profile_01','river_bank')
            result['bankObjects'].append(bank.name)
    from bridge_integration import build_bridges
    result['bridges']=build_bridges(source,plan,api,lib,coll,scale)
    # Sparse flow-aligned strokes remain entirely within the source water.
    from harbor_geometry import inside
    center=[(p['x']*scale,p['y']*scale) for p in source['river']['centerline']]
    verts=[];faces=[]
    for i,(a,b) in enumerate(zip(center,center[1:])):
        if i%2:continue
        length=math.dist(a,b)
        if length<1e-5:continue
        tangent=((b[0]-a[0])/length,(b[1]-a[1])/length);normal=(-tangent[1],tangent[0])
        for side in (-1,1):
            p=((a[0]+b[0])/2+normal[0]*side*.8,(a[1]+b[1])/2+normal[1]*side*.8)
            ring=[(p[0]+tangent[0]*t+normal[0]*w,p[1]+tangent[1]*t+normal[1]*w)
                  for t,w in ((-.8,-.018),(.8,-.018),(.8,.018),(-.8,.018))]
            if not all(inside(q,plan['water']) for q in ring):continue
            k=len(verts);verts.extend([(x,y,plan['waterLevel']+.008) for x,y in ring]);faces.append(tuple(k+j for j in range(4)))
    if verts:
        strokes=mesh('River_flow_strokes',verts,faces,lib.materials['water_light'],'09_RIVER')
        strokes['environment_extent']=True;strokes['source_terrain_role']='river_ripples'
        strokes['terrain_water_layer']=True;strokes['water_body']='river';strokes['water_layer']='ripples'
    print('River geometry:',len(result['landObjects']),'banks;',len(result['bridges']),'stone arch bridges',flush=True)
    return result
