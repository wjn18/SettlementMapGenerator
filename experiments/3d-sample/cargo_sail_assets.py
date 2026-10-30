"""Three original cargo sailboats sharing the harbor's editable hull recipe."""
import math


def cloth(shape, corners, color='linen', reef=.18):
    """A partly reefed, slightly slack four-corner sail with stitched edges."""
    cols, rows = 6, 7
    vertices=[]
    for j in range(rows+1):
        v=j/rows
        for i in range(cols+1):
            u=i/cols
            bottom=[corners[0][k]*(1-u)+corners[1][k]*u for k in range(3)]
            top=[corners[3][k]*(1-u)+corners[2][k]*u for k in range(3)]
            p=[bottom[k]*(1-v)+top[k]*v for k in range(3)]
            p[1]-=reef*math.sin(math.pi*u)*math.sin(math.pi*v)
            vertices.append(tuple(p))
    shape.poly(vertices,[(j*(cols+1)+i,j*(cols+1)+i+1,(j+1)*(cols+1)+i+1,(j+1)*(cols+1)+i) for j in range(rows) for i in range(cols)],color)
    for i in (0,2,4,6):shape.path([vertices[j*(cols+1)+i] for j in range(rows+1)],.012,'oak_light',4)
    for j in (0,rows):shape.path([vertices[j*(cols+1)+i] for i in range(cols+1)],.022,'oak_light',4)


def build_cargo_sailboats(kit, hull):
    variants=[('sloop','单桅货运帆船',9.2,2.7,1.1),('ketch','双桅货运帆船',10.4,3.0,1.25),('lugger','短桅宽体货运帆船',8.6,3.3,1.15)]
    for style,title,length,width,height in variants:
        shape=hull(length,width,height);deck=height*.30
        ring=[(x*length,w*width*.46,deck) for x,w in shape.hull_profile['stations']]
        ring += [(x*length,-w*width*.46,deck) for x,w in reversed(shape.hull_profile['stations'])]
        shape.poly(ring,[tuple(range(len(ring)))],'oak_light')
        for x in (-length*.12,length*.15):
            shape.box((x,0,deck+.17),(length*.19,width*.57,.32),'oak')
            shape.box((x,0,deck+.35),(length*.20,width*.59,.08),'oak_light')
            for y in (-width*.21,width*.21):shape.box((x,y,deck+.40),(length*.20,.04,.025),'iron')
        # Low stern cabin, rudder, cargo hoist, stowed poles and coiled warps.
        shape.box((-length*.30,0,deck+.43),(length*.16,width*.54,.86),'oak_light')
        shape.box((-length*.30,0,deck+.91),(length*.18,width*.59,.11),'slate')
        for y in (-1,1):
            shape.box((-length*.30,y*width*.274,deck+.51),(.33,.025,.31),'glass')
            shape.torus((length*.34,y*width*.14,deck+.10),.19,.026,'oak_light',16)
            shape.beam((-length*.16,y*width*.37,deck+.10),(length*.25,y*width*.37,deck+.10),.035,'oak')
        shape.box((-length*.51,0,-.05),(.14,.12,height*.9),'oak')
        shape.beam((-length*.50,0,.37),(-length*.35,.12,.44),.04,'oak')
        def mast(x,top):
            shape.beam((x,0,deck),(x,0,top),.105,'oak')
            for end in (-.42,.43):shape.beam((length*end,0,deck+.15),(x,0,top-.15),.017,'oak_light',4)
            for sign in (-1,1):shape.beam((x-.55,sign*width*.40,deck+.1),(x,0,top*.72),.016,'oak_light',4)
            shape.beam((x,0,2.0),(x+1.3,.20,2.8),.055,'oak')
            shape.beam((x+1.3,.20,2.8),(x+1.3,.20,1.8),.018,'oak_light',4)
        if style=='sloop':
            x=.1;top=7.8;mast(x,top)
            main=[(-3.3,-.06,2.2),(x,-.06,2.2),(x,-.06,7.4),(-2.9,-.06,6.2)]
            cloth(shape,main)
            shape.beam(main[0],main[1],.055,'oak');shape.beam(main[2],main[3],.045,'oak')
            cloth(shape,[(.35,-.09,2.6),(3.9,-.09,2.0),(.35,-.09,6.5),(.24,-.09,6.5)],'linen',.12)
        elif style=='ketch':
            for x,top,span,color in ((1.1,8.2,3.0,'linen'),(-2.8,5.8,1.6,'cloth_blue')):
                mast(x,top)
                sail=[(x-span,-.07,2.4),(x,-.07,2.1),(x,-.07,top-.4),(x-span*.76,-.07,top-1.3)]
                cloth(shape,sail,color)
                shape.beam(sail[0],sail[1],.05,'oak');shape.beam(sail[2],sail[3],.04,'oak')
            cloth(shape,[(1.35,-.1,2.5),(4.65,-.1,2.0),(1.35,-.1,7.0),(1.24,-.1,7.0)],'linen',.10)
        else:
            x=-.65;top=6.2;mast(x,top)
            sail=[(-2.7,-.08,2.7),(2.8,-.08,2.7),(2.2,-.08,5.9),(-2.1,-.08,6.5)]
            cloth(shape,sail,'linen',.12)
            shape.beam(sail[2],sail[3],.07,'oak')
            # A gathered lower panel makes this the visibly reefed variant.
            for z in (2.62,2.69,2.76):shape.beam((-2.7,-.09,z),(2.8,-.09,z),.045,'linen',6)
            for x in (-2,-1,0,1,2):shape.beam((x,-.16,2.59),(x,-.16,2.81),.018,'oak_light',4)
        aid='harbor_cargo_'+style+'_01'
        kit.asset(aid,'13_HARBOR','harbor_boats',title,{'boat':shape},'WATER_XY',snaps={'WATERLINE':(0,0,0),'BOW':(length/2,0,0),'STERN':(-length/2,0,0)},notes='Cargo sailboat, stowed equipment, partly reefed canvas; uniform fitting at source-planned berths.')
        kit.ASSETS[-1]['hullProfile']=shape.hull_profile
        kit.ASSETS[-1]['vesselClass']='cargo-sail'
