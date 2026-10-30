"""Metric layout of a keep's inset roof and at most four corner turrets."""
import math


def inside(p,poly):
    hit=False
    for a,b in zip(poly,poly[1:]+poly[:1]):
        if (a[1]>p[1])!=(b[1]>p[1]) and p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]:hit=not hit
    return hit


def boundary_distance(p,poly):
    distances=[]
    for a,b in zip(poly,poly[1:]+poly[:1]):
        dx,dy=b[0]-a[0],b[1]-a[1];ll=dx*dx+dy*dy
        t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/ll)) if ll else 0
        distances.append(math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy))
    return min(distances)


def plan_keep(poly,along,role='keep'):
    u=along;v=(u[1],-u[0]);dot=lambda p,a:p[0]*a[0]+p[1]*a[1]
    us,vs=[dot(p,u) for p in poly],[dot(p,v) for p in poly]
    length,width=max(us)-min(us),max(vs)-min(vs)
    center=(sum(p[0] for p in poly)/len(poly),sum(p[1] for p in poly)/len(poly))
    if not inside(center,poly):
        candidates=[(min(p[0] for p in poly)+(max(p[0] for p in poly)-min(p[0] for p in poly))*i/25,
                     min(p[1] for p in poly)+(max(p[1] for p in poly)-min(p[1] for p in poly))*j/25) for i in range(1,25) for j in range(1,25)]
        center=max((p for p in candidates if inside(p,poly)),key=lambda p:boundary_distance(p,poly))
    def rectangle(c,w,l):return [(c[0]+v[0]*x+u[0]*y,c[1]+v[1]*x+u[1]*y) for x,y in [(-w/2,-l/2),(w/2,-l/2),(w/2,l/2),(-w/2,l/2)]]
    def fits(ring,margin=.1):
        samples=ring+[tuple((a[k]+b[k])/2 for k in (0,1)) for a,b in zip(ring,ring[1:]+ring[:1])]
        return all(inside(p,poly) and boundary_distance(p,poly)>=margin for p in samples)
    eave=max(17.8,min(24,width*.38+11)) if role=='keep' else max(5.5,min(9,width*.30+4))
    turrets=[];size=min(4.3,width*.17,length*.14)
    if role=='keep' and size>.85:
        corners=[]
        for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]:
            p=max(poly,key=lambda p:x*dot(p,v)/width+y*dot(p,u)/length)
            if p not in corners:corners.append(p)
        for corner in corners:
            for j in range(1,31):
                t=j/50;c=tuple(corner[k]+(center[k]-corner[k])*t for k in (0,1))
                ring=rectangle(c,size,size)
                if fits(ring,.85) and all(math.dist(c,q['center'])>size*1.5 for q in turrets):
                    turrets.append({'center':c,'size':size,'polygon':ring});break
    rw,rl=width*.58,length*.60
    for _ in range(75):
        roof=rectangle(center,rw,rl)
        clear=all(abs(dot(q['center'],v)-dot(center,v))>(rw+q['size'])/2+.3 or abs(dot(q['center'],u)-dot(center,u))>(rl+q['size'])/2+.3 for q in turrets)
        if fits(roof,.45) and clear:break
        rw*=.94;rl*=.94
    else:raise ValueError('Castle footprint cannot support an inset roof')
    return {'role':role,'eave':eave,'center':center,'along':list(u),'across':list(v),'turrets':turrets,
            'roof':{'center':center,'width':rw,'length':rl,'rise':min(3.2,rw*.28),'polygon':roof}}
