"""Explicitly labelled stand-ins for vegetation and fountains in the source plan."""
import math
import json
from mathutils import Vector
import bpy


def build_fountain(feature, api, collection_name):
    """Keep the supplied basin boundary exact; all vertical detail is provisional."""
    from props import material
    poly = api['points'](feature['points'])
    if len(poly) < 3:
        return None
    center = api['center'](poly)
    name = 'Planning_fountain_' + str(feature['id'])
    stone = api['M']['stone_plain']
    water = material('Fountain water / pale blue green wash', (.40, .55, .53))
    source_points = feature.get('source_points', feature['points'])
    objects = []

    def tag(obj, role):
        obj['source_feature_id'] = str(feature['id'])
        obj['asset_kind'] = 'fountain'
        obj['asset_role'] = role
        obj['representation'] = 'procedural_placeholder'
        obj['source_feature_points'] = json.dumps(source_points)
        obj['input_footprint_xy'] = [value for point in poly for value in point]
        objects.append(obj.name)
        return obj

    def inset(factor):
        return [(center[0] + (x-center[0])*factor,
                 center[1] + (y-center[1])*factor) for x, y in poly]

    base = tag(api['extrude'](name, poly, .045, .20, stone, collection_name), 'exact_footprint_base')
    # A closed annulus leaves the basin genuinely open instead of filling it
    # with an opaque cylinder. Its two outlines follow the source polygon.
    outer, inner = inset(.94), inset(.81)
    n = len(poly)
    vertices = [(x, y, z) for ring, z in ((outer, .20), (outer, .82),
                                         (inner, .20), (inner, .82)) for x, y in ring]
    faces = []
    for i in range(n):
        j = (i+1) % n
        faces.extend([(i, j, n+j, n+i), (2*n+i, 3*n+i, 3*n+j, 2*n+j),
                      (n+i, n+j, 3*n+j, 3*n+i), (i, 2*n+i, 2*n+j, j)])
    tag(api['mesh'](name+'_basin_wall', vertices, faces, stone, collection_name), 'basin_wall')
    tag(api['extrude'](name+'_water', inner, .44, .46, water, collection_name), 'water_surface')

    # A modest central column and shallow upper bowl read clearly from above.
    # Their dimensions depend on the supplied basin instead of a city preset.
    radius = min(math.dist(center, point) for point in poly)
    column_radius = min(.38, radius*.15)
    bowl_radius = min(.86, radius*.31)
    def circle(r):
        return [(center[0]+r*math.cos(i*math.tau/12),
                 center[1]+r*math.sin(i*math.tau/12)) for i in range(12)]
    tag(api['extrude'](name+'_column_foot', circle(column_radius*1.5), .46, .68,
                       stone, collection_name), 'column_foot')
    tag(api['extrude'](name+'_column', circle(column_radius), .68, 1.75,
                       stone, collection_name), 'central_column')
    # Flared bowl uses an explicit side profile, avoiding a floating flat plate.
    vertices = [(x, y, z) for r, z in ((column_radius, 1.53), (bowl_radius, 1.87),
                                     (bowl_radius, 1.99)) for x, y in circle(r)]
    faces = [tuple(reversed(range(12))), tuple(range(24, 36))]
    faces.extend((row*12+i, row*12+(i+1)%12, (row+1)*12+(i+1)%12, (row+1)*12+i)
                 for row in range(2) for i in range(12))
    tag(api['mesh'](name+'_upper_bowl', vertices, faces, stone, collection_name), 'upper_bowl')
    tag(api['extrude'](name+'_upper_water', circle(bowl_radius*.88), 1.99, 2.005,
                       water, collection_name), 'upper_water_surface')
    tag(api['extrude'](name+'_spout', circle(column_radius*.38), 2.005, 2.32,
                       stone, collection_name), 'central_spout')
    return {'sourceId': feature['id'], 'kind': 'fountain', 'status': 'procedural_placeholder',
            'sourcePoints': source_points, 'scenePoints': [list(p) for p in poly],
            'sceneCenter': list(center), 'footprintPreserved': True,
            'groundObject': base.name, 'objects': objects,
            'note': 'Exact source basin footprint; basin, water and central column are provisional modular geometry.'}


def build_planning_features(data, api):
    from props import material, segment_distance, boundary_distance
    points, inside, center = api['points'], api['inside'], api['center']
    mesh, extrude, Batch = api['mesh'], api['extrude'], api['Batch']
    coll = '05_PLANNING_FEATURES'
    leaf = material('Grove placeholder / sage watercolor', (.43, .49, .32))
    leaf_light = material('Grove placeholder / olive watercolor', (.57, .59, .39))
    earth = material('Grove ground / sparse sage wash', (.70, .72, .57))
    footprints = [points(b['points']) for b in data['buildings']]
    road_segments = [(a,b,r['width']) for r in data['roads']
                     for a,b in zip(points(r['points']), points(r['points'])[1:])]
    records = []
    fountains = []
    for feat in data.get('features', []):
        if feat.get('kind') == 'fountain':
            record = build_fountain(feat, api, coll)
            if record:
                fountains.append(record)
            continue
        if feat.get('kind') != 'grove':
            continue
        poly = points(feat['points']); rng = api['rng_for']('grove/' + feat['id'])
        base = extrude('Planning_grove_' + feat['id'], poly, .041, .045, earth, '00_GROUND')
        base['source_feature_id'] = feat['id']; base['asset_kind'] = 'grove_region'
        base['representation'] = 'procedural_placeholder'
        base['source_feature_points'] = json.dumps(feat.get('source_points', feat['points']))
        minx,maxx = min(x for x,y in poly),max(x for x,y in poly)
        miny,maxy = min(y for x,y in poly),max(y for x,y in poly)
        target = max(2,min(22,round(api['poly_area'](poly)/17)))
        accepted = []
        for attempt in range(1500):
            q = center(poly) if attempt == 0 else (rng.uniform(minx,maxx),rng.uniform(miny,maxy))
            radius = rng.uniform(.65,1.65)
            if not inside(q,poly) or boundary_distance(q,poly)<radius: continue
            if any(inside(q,p) or boundary_distance(q,p)<radius+.4 for p in footprints): continue
            if any(segment_distance(q,a,b)<w/2+radius+.2 for a,b,w in road_segments): continue
            if any(math.dist(q,p)<radius+r+.35 for p,r in accepted): continue
            accepted.append((q,radius))
            if len(accepted)>=target: break
        for i,(q,radius) in enumerate(accepted):
            height = rng.uniform(3.8,6.5)
            trunk=Batch(f'Grove_{feat["id"]}_{i}_trunk',api['M']['timber'],coll)
            trunk.beam((*q,.05),(*q,height*.75),.16+radius*.05)
            for angle in (0.3,2.3,4.4):
                trunk.beam((*q,height*.43),(q[0]+radius*.65*math.cos(angle),q[1]+radius*.65*math.sin(angle),height*.78),.10)
            obj=trunk.finish(); obj['source_feature_id']=feat['id'];obj['asset_kind']='tree_placeholder'
            verts=[];faces=[];sides=11;rings=7
            for j in range(rings):
                phi=math.pi*(j+.05)/(rings-.9)
                rr=max(.04,math.sin(phi))*radius
                z=height*.69 + math.cos(phi)*height*.30
                for k in range(sides):
                    a=k*math.tau/sides;f=rng.uniform(.89,1.08)
                    verts.append((q[0]+rr*math.cos(a)*f,q[1]+rr*math.sin(a)*f,z+rng.uniform(-.10,.10)))
            for j in range(rings-1):
                for k in range(sides):
                    n=(k+1)%sides;faces.append((j*sides+k,j*sides+n,(j+1)*sides+n,(j+1)*sides+k))
            faces.extend([tuple(reversed(range(sides))),tuple((rings-1)*sides+k for k in range(sides))])
            crown=mesh(f'Grove_{feat["id"]}_{i}_crown',verts,faces,leaf if i%2 else leaf_light,coll)
            crown['source_feature_id']=feat['id'];crown['asset_kind']='tree_placeholder'
        records.append({'sourceId':feat['id'],'kind':'grove','status':'procedural_placeholder',
                        'sourcePoints':feat.get('source_points',feat['points']),
                        'treeCount':len(accepted),'groundObject':base.name,
                        'note':'Exact planned grove region; decorative tree positions and shapes are provisional.'})
    represented = {str(o.get('source_feature_id')) for o in bpy.context.scene.objects if o.get('source_feature_id')}
    return {'groves':records,'fountains':fountains,'representedSourceFeatureIds':sorted(represented),
            'unrepresentedSourceFeatureIds':[f['id'] for f in data.get('features',[]) if f['id'] not in represented]}
