"""Assemble every planned market with stable IDs and shared reservations."""
import hashlib
import math

import bpy
from mathutils import Matrix, Vector


def convex_outline(points):
    points=sorted(set((float(p[0]),float(p[1])) for p in points))
    if len(points)<3:return []
    def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    lower=[];upper=[]
    for point in points:
        while len(lower)>1 and cross(lower[-2],lower[-1],point)<=1e-10:lower.pop()
        lower.append(point)
    for point in reversed(points):
        while len(upper)>1 and cross(upper[-2],upper[-1],point)<=1e-10:upper.pop()
        upper.append(point)
    return lower[:-1]+upper[:-1]


def fortification_outlines(library,gate_mounts):
    """Reserve real native structures and the authored gate installation."""
    outlines=[]
    collection=bpy.data.collections.get('02_CITY_WALL')
    if collection:
        for obj in collection.all_objects:
            if obj.type=='MESH':
                outline=convex_outline([obj.matrix_world@v.co for v in obj.data.vertices])
                if outline:outlines.append(outline)
    if library:
        from asset_integration import wall_basis
        for i,mount in enumerate(gate_mounts or []):
            width=mount['width'];normal=Vector((*mount['normal'],0))
            origin=Vector((*mount['origin'],0));basis=wall_basis(mount['along'],mount['normal'])
            stretch=Matrix.Diagonal((width/4,1,1.25,1))
            parts=[('gate_arch_trim_0'+str(1+i%2),None,origin+normal*1.72)]
            parts.extend(('gate_hardware_01',part,origin) for part in ('left_leaf_open','right_leaf_open','portcullis_raised','lamps'))
            for aid,part,position in parts:
                matrix=Matrix.Translation(position)@basis@stretch
                outline=convex_outline([matrix@v.co for v in library.part(aid,part).vertices])
                if outline:outlines.append(outline)
    return outlines


def planned_markets(data):
    return sorted(({'id': district['id'], 'points': district['points']}
                   for district in data.get('districts', []) if district.get('wardType') == 'Market'),
                  key=lambda item: item['id'])


def aggregate_market_props(rows):
    totals = {key: sum(row['props'].get(key, 0) for row in rows)
              for key in ('stalls', 'people', 'well', 'statues', 'cart', 'cargo_groups', 'objects',
                          'roadside_people', 'people_reservation_rejections')}
    for key in ('statue_planning_locations', 'fountain_reserved_locations', 'stall_positions', 'customers_per_stall'):
        totals[key] = [item for row in rows for item in row['props'].get(key, [])]
    for key in ('people_clearance_verified', 'people_reserved_clearance_verified','people_structure_clearance_verified'):
        totals[key] = all(row['props'].get(key, True) for row in rows)
    for key in ('people_footprint_radius_m', 'reserved_passage_count', 'reserved_water_count','reserved_structure_count'):
        totals[key] = max((row['props'].get(key, 0) for row in rows), default=0)
    totals.update(marketCount=len(rows), marketIds=[row['id'] for row in rows])
    return totals


def build_markets(data, api, library, scale, enabled=True, gate_mounts=None):
    from props import build_market
    points = api['points']
    markets = planned_markets(data)
    structures=fortification_outlines(library,gate_mounts)
    rows = []
    shared_occupied = []
    # Fixed planning features must be protected before the first market places
    # overflow pedestrians near another market that has not been built yet.
    for feature in data.get('features', []):
        if feature['kind'] not in ('fountain', 'statue'):
            continue
        polygon = points(feature['points'])
        if not polygon:
            continue
        center = tuple(sum(p[i] for p in polygon)/len(polygon) for i in (0, 1))
        shared_occupied.append({'center': center, 'radius': max(math.dist(center, p) for p in polygon)+.35,
                                'marketId': feature['districtId'], 'kind': 'planned_feature', 'object': None})
    bridge_paths = [{'points': points(bridge['points']), 'width': bridge['width']*scale}
                    for bridge in data.get('river', {}).get('bridges', [])]
    bridge_paths.extend({'points': points(dock['points']), 'width': dock['width']*scale}
                        for dock in data.get('terrain',{}).get('docks',[]) if dock.get('waterbody')=='river')
    water = [points(raw) for raw in (data.get('river', {}).get('surface'),
             data.get('terrain', {}).get('coast', {}).get('water')) if raw]
    citizen_radius = max((math.hypot(vertex.co.x, vertex.co.y) for aid in library.entries
                          if aid.startswith('citizen_') for vertex in library.part(aid).vertices), default=.8) if library else None
    for market in markets:
        mid = market['id']
        seed = int(hashlib.sha256((str(data.get('seed', 7))+'/market/'+mid).encode()).hexdigest()[:8], 16)
        stats = {'stalls': 0, 'people': 0, 'well': 0, 'statues': 0, 'cart': 0, 'cargo_groups': 0,
                 'objects': 0, 'capacityStatus': 'disabled', 'emptyReason': 'Market props were disabled for this scene.'}
        if enabled:
            stats = build_market(points(market['points']), [points(b['points']) for b in data['buildings']],
                data['roads'], api['M'], seed=seed,
                features=[feature for feature in data.get('features', []) if feature['districtId'] == mid],
                authored_assets=bool(library), reserved_paths=bridge_paths, water_polygons=water,
                person_radius=citizen_radius, market_id=mid, shared_occupied=shared_occupied,
                other_market_polygons=[points(other['points']) for other in markets if other['id'] != mid],
                structure_polygons=structures)
        rows.append({'id': mid, 'groundObject': 'Original_market_square_'+mid,
                     'seed': seed, 'props': stats, 'objects': list(stats.get('objectNames', []))})
        print('MARKET_READY '+mid+' '+str(stats.get('stalls', 0))+' stalls '+str(stats.get('people', 0))+' people', flush=True)
    return aggregate_market_props(rows), {'enabled': bool(markets), 'version': 1, 'propsEnabled': enabled,
        'plazas': rows, 'policy': 'Every source Market is represented by ID; market-local random streams share whole-scene placement reservations.'}


def finalize_markets(data, manifest, library=None):
    """Capture ownership after native props have received authored goods."""
    market_ids = {row['id'] for row in manifest['plazas']}
    feature_owners = {feature['id']: feature['districtId'] for feature in data.get('features', [])
                      if feature['districtId'] in market_ids}
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        owner = feature_owners.get(obj.get('source_feature_id'))
        if not owner and obj.get('source_district_id') in market_ids:
            owner=obj.get('source_district_id')
        if owner:
            obj['source_market_id'] = owner
    for row in manifest['plazas']:
        objects = sorted(obj.name for obj in bpy.context.scene.objects if obj.type == 'MESH'
                         and obj.get('source_market_id') == row['id'] and obj.get('asset_kind') != 'market_plaza')
        row['objects'] = objects
        row['props']['nativeObjectCount'] = row['props'].get('objects', 0)
        row['props']['objects'] = len(objects)
        row['props']['authoredCitizenMeshes'] = sum(bpy.data.objects[name].get('asset_mount_role') == 'citizen' for name in objects)
        row['props']['authoredMarketGoodsMeshes'] = sum(bpy.data.objects[name].get('asset_mount_role') == 'market_goods' for name in objects)
    if library:
        for instance in library.instances:
            obj=bpy.data.objects.get(instance['object'])
            instance['sourceMarketId']=obj.get('source_market_id') if obj else None
