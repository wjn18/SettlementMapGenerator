"""Cut static water geometry at each vessel's actual exterior waterline."""
import json
import bpy
from mathutils import Vector
from harbor_geometry import area, hull_ring, subtract_convex

WATER_OBJECTS=('Harbor_sea_surface','Harbor_shallow_water','Harbor_broken_ripples')


def terrain_water_objects():
    """All participating sea/river layers, including legacy harbor names."""
    return [obj for obj in bpy.context.scene.objects if obj.type=='MESH' and
            (obj.get('terrain_water_layer') or obj.name in WATER_OBJECTS)]


def boat_section(boat, world_z):
    profile=json.loads(boat['hull_profile'])
    inverse=boat.matrix_world.inverted()
    z=(inverse@Vector((boat.matrix_world.translation.x,boat.matrix_world.translation.y,world_z))).z
    return [(p.x,p.y) for x,y in hull_ring(profile,z) for p in [boat.matrix_world@Vector((x,y,z))]]


def exclude_boat_interiors(boats):
    reports=[]
    for obj in terrain_water_objects():
        name=obj.name
        source=obj.data;source.calc_loop_triangles()
        vertices=[tuple(v.co) for v in source.vertices]
        lookup={tuple(round(c,6) for c in p):i for i,p in enumerate(vertices)}
        z=vertices[0][2] if vertices else 0
        holes=[boat_section(boat,z) for boat in boats]
        faces=[];removed_area=0
        for triangle in source.loop_triangles:
            poly=[vertices[i][:2] for i in triangle.vertices]
            pieces=[poly]
            for hole in holes:
                if hole:pieces=[part for piece in pieces for part in subtract_convex(piece,hole)]
            removed_area+=area(poly)-sum(area(p) for p in pieces)
            for piece in pieces:
                indices=[]
                for x,y in piece:
                    key=(round(x,6),round(y,6),round(z,6))
                    if key not in lookup:lookup[key]=len(vertices);vertices.append((x,y,z))
                    if not indices or indices[-1]!=lookup[key]:indices.append(lookup[key])
                if len(indices)>1 and indices[0]==indices[-1]:indices.pop()
                if len(set(indices))>=3:faces.append(tuple(indices))
        result=bpy.data.meshes.new(source.name+' / dry boat interiors')
        result.from_pydata(vertices,[],faces);result.update()
        for material in source.materials:result.materials.append(material)
        obj.data=result
        if not source.users:bpy.data.meshes.remove(source)
        obj['boat_water_exclusion']=1;obj['water_exclusion_boat_count']=len(boats)
        reports.append({'object':name,'boatCount':len(boats),'removedAreaSceneUnits2':removed_area,'faces':len(faces)})
    return reports
