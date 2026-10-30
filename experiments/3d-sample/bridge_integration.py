"""Raised stone arches on the unchanged two-dimensional bridge paths."""
import math
from bridge_geometry import profile, band_geometry, segments, ARCH_THICKNESS, ROAD_Z
from river_geometry import rectangle


def build_bridges(source, plan, api, lib, collection, scale):
    result = []
    for bridge in plan['bridges']:
        path = bridge['points']; design = profile(path)
        record = {'id': bridge['id'], 'roadId': bridge['roadId'],
                  'points': next(b['points'] for b in source['river']['bridges'] if b['id']==bridge['id']),
                  'width': bridge['width']/scale, 'roadWidth': bridge['roadWidth']/scale,
                  'profile': design, 'deckObjects': [], 'supports': [], 'abutments': [], 'rails': []}
        def tag(obj, role, group):
            obj['source_bridge_id']=bridge['id'];obj['source_road_id']=bridge['roadId']
            obj['asset_mount_role']=role;obj['bridge_style']='stone-arch';obj['ink_structural']=True;obj.pass_index=0
            record[group].append(obj.name)
            return obj
        def band(name, width, lower, upper, role, group, side=0., material='stone'):
            vertices, faces=band_geometry(path,width,lower,upper,side)
            return tag(api['mesh'](bridge['id']+'_'+name,vertices,faces,api['M'][material],'09_RIVER'),role,group)
        arch=band('stone_arch',bridge['width'],-ARCH_THICKNESS,-.008,'bridge_deck','deckObjects')
        record['supports'].append(arch.name)
        side=(bridge['width']+bridge['roadWidth'])/4
        rail_width=min(.36,(bridge['width']-bridge['roadWidth'])/2-.06)
        for sign in (-1,1):
            band('parapet_'+str(sign),rail_width,.015,.93,'bridge_rail','rails',sign*side)
            band('coping_'+str(sign),rail_width+.05,.93,1.04,'bridge_rail_end','rails',sign*side,'stone_plain')
        # Bed-founded bearings are at the dry endpoints; no mid-channel piles.
        for end,(a,b) in enumerate(((path[0],path[1]),(path[-1],path[-2]))):
            length=math.dist(a,b);u=((b[0]-a[0])/length,(b[1]-a[1])/length)
            start=(a[0]-u[0]*1.0,a[1]-u[1]*1.0);finish=(a[0]+u[0]*.25,a[1]+u[1]*.25)
            obj=api['extrude'](bridge['id']+'_stone_abutment_'+str(end),rectangle(start,finish,bridge['width']),plan['bedLevel'],ROAD_Z-ARCH_THICKNESS,api['M']['stone'],'09_RIVER')
            tag(obj,'bridge_abutment','abutments')
        verts=[];faces=[]
        for i,(a,b,za,zb) in enumerate(segments(path)):
            if i%2:continue
            length=math.dist(a,b);u=((b[0]-a[0])/length,(b[1]-a[1])/length);n=(-u[1],u[0])
            for sign in (-1,1):
                x=a[0]+n[0]*sign*(bridge['width']/2+.002);y=a[1]+n[1]*sign*(bridge['width']/2+.002);k=len(verts)
                verts.extend(((x-u[0]*.012,y-u[1]*.012,za-ARCH_THICKNESS),(x+u[0]*.012,y+u[1]*.012,za-ARCH_THICKNESS),
                              (x+u[0]*.012,y+u[1]*.012,za-.008),(x-u[0]*.012,y-u[1]*.012,za-.008)))
                faces.append(tuple(k+j for j in range(4)))
        tag(api['mesh'](bridge['id']+'_arch_joints',verts,faces,lib.materials['ink'],'09_RIVER'),'bridge_arch_joints','supports')
        result.append(record)
    return result
