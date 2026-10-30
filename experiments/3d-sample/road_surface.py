"""Flat road ribbons with round outside joins and shared junction paving."""
import math
from harbor_geometry import subtract_convex
from footprint_geometry import float32


def disjoint_surface(vertices,faces):
    """Union convex paving cells without coplanar overlapping faces.

    Keep the original rectangle reference vertices for source-width auditing;
    only the exposed union is rendered. Cut pieces share indexed vertices.
    """
    polygons=[[vertices[i][:2] for i in face] for face in faces]
    lookup={(round(p[0],8),round(p[1],8)):i for i,p in enumerate(vertices)}
    result=[];previous=[];z=vertices[0][2] if vertices else .035
    for polygon in polygons:
        pieces=[polygon]
        for covered in previous:
            pieces=[part for piece in pieces for part in subtract_convex(piece,covered)]
            if not pieces:break
        previous.append(polygon)
        for piece in pieces:
            indices=[]
            for p in piece:
                key=(round(p[0],8),round(p[1],8))
                if key not in lookup:lookup[key]=len(vertices);vertices.append((*p,z))
                if not indices or indices[-1]!=lookup[key]:indices.append(lookup[key])
            if len(indices)>1 and indices[0]==indices[-1]:indices.pop()
            for j in range(1,len(indices)-1):
                face=(indices[0],indices[j],indices[j+1]);a,b,c=(tuple(float32(x) for x in vertices[i]) for i in face)
                cross=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
                if abs(cross)>1e-10:result.append(face if cross>0 else tuple(reversed(face)))
    return vertices,result


def ribbon_geometry(points,width,z=.035):
    vertices=[];faces=[];radius=width/2
    for a,b in zip(points,points[1:]):
        length=math.dist(a,b)
        # Short, nonzero gate-curve segments still connect distinct source
        # endpoints. Dropping one leaves a real slit between its neighbours.
        if length==0:continue
        nx=-(b[1]-a[1])/length*radius;ny=(b[0]-a[0])/length*radius;k=len(vertices)
        vertices.extend([(a[0]+nx,a[1]+ny,z),(a[0]-nx,a[1]-ny,z),(b[0]-nx,b[1]-ny,z),(b[0]+nx,b[1]+ny,z)])
        faces.append((k,k+1,k+2,k+3))
    for a,p,b in zip(points,points[1:],points[2:]):
        incoming=math.atan2(p[1]-a[1],p[0]-a[0]);outgoing=math.atan2(b[1]-p[1],b[0]-p[0])
        turn=(outgoing-incoming+math.pi)%math.tau-math.pi
        if abs(turn)<1e-5:continue
        start=incoming-math.copysign(math.pi/2,turn);steps=max(2,math.ceil(abs(turn)/(math.pi/36)))
        center=len(vertices);vertices.append((*p,z))
        for j in range(steps+1):
            angle=start+turn*j/steps;vertices.append((p[0]+radius*math.cos(angle),p[1]+radius*math.sin(angle),z))
        for j in range(steps):
            face=(center,center+1+j,center+2+j)
            faces.append(face if turn>0 else tuple(reversed(face)))
    return disjoint_surface(vertices,faces)


def junction_geometry(roads,z=.035):
    nodes={}
    for road in roads:
        points=road['points']
        for i,p in enumerate(points):
            key=(round(p[0],6),round(p[1],6));node=nodes.setdefault(key,{'point':p,'neighbors':set(),'width':0})
            node['width']=max(node['width'],road['width'])
            for j in (i-1,i+1):
                if 0<=j<len(points):node['neighbors'].add((round(points[j][0],6),round(points[j][1],6)))
    vertices=[];faces=[];junctions=[]
    for node in nodes.values():
        if len(node['neighbors'])<3:continue
        p=node['point'];radius=node['width']/2;start=len(vertices);vertices.append((*p,z))
        vertices.extend((p[0]+radius*math.cos(i*math.tau/32),p[1]+radius*math.sin(i*math.tau/32),z) for i in range(32))
        faces.extend((start,start+1+i,start+1+(i+1)%32) for i in range(32));junctions.append({'point':p,'radius':radius})
    return vertices,faces,junctions
