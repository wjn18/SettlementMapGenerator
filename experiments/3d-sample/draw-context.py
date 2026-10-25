"""Show the complete source plan and the unchanged sample crop side by side in context.

This is a diagram of existing JSON data; it never edits planning geometry.
"""
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'artifacts' / '3d-sample'
OUT = SOURCE / 'v2'
OUT.mkdir(parents=True, exist_ok=True)
town = json.loads((SOURCE / 'source-town.json').read_text(encoding='utf-8'))
selection = json.loads((SOURCE / 'selection.json').read_text(encoding='utf-8'))
vertices = {v['id']: v for v in town['vertices']}
selected_ids = {b['id'] for b in selection['buildings']}
S = 2
W, H = 1600, 1400
im = Image.new('RGB', (W*S, H*S), '#fbfaf6')
d = ImageDraw.Draw(im)
FONT = 'C:/Windows/Fonts/msyh.ttc'

def font(size):
    return ImageFont.truetype(FONT, round(size*S))

def text(x, y, value, size=21, fill='#625e55', anchor=None):
    d.text((x*S, y*S), value, font=font(size), fill=fill, anchor=anchor)

def screenline(points, color, width=1):
    d.line([(round(x*S), round(y*S)) for x, y in points], fill=color,
           width=max(1, round(width*S)), joint='curve')

def rounded_box(box, fill, outline=None, width=1, radius=9):
    d.rounded_rectangle(tuple(round(n*S) for n in box), radius=radius*S,
                        fill=fill, outline=outline, width=max(1, round(width*S)))

# Framing uses every original building, the original city wall, and the crop.
framing = [vertices[v] for b in town['buildings'] for v in b['boundary']]
framing += [vertices[v] for w in town['walls'] for v in w['boundary']]
framing += selection['cropPolygon']
min_x, max_x = min(p['x'] for p in framing)-22, max(p['x'] for p in framing)+22
min_y, max_y = min(p['y'] for p in framing)-20, max(p['y'] for p in framing)+20
plot = (140, 228, 1370, 1200)
scale = min((plot[2]-plot[0])/(max_x-min_x), (plot[3]-plot[1])/(max_y-min_y))
ox = (plot[0]+plot[2]-(max_x-min_x)*scale)/2
oy = (plot[1]+plot[3]-(max_y-min_y)*scale)/2

def p(v):
    return ox + (v['x']-min_x)*scale, oy + (v['y']-min_y)*scale

def poly(points, fill, outline=None, width=1):
    pts = [p(v) for v in points]
    d.polygon([(round(x*S), round(y*S)) for x, y in pts], fill=fill)
    if outline:
        screenline(pts+[pts[0]], outline, width)

def line(points, color, width=1):
    screenline([p(v) for v in points], color, width)

def dashed(points, color='#ab6f43', width=2.7, dash=11, gap=7):
    phase = 0.0
    for a, b in zip(points, points[1:]):
        length = math.dist(a, b)
        if length < 1e-9:
            continue
        along = 0.0
        while along < length:
            visible = phase < dash
            left = dash-phase if visible else dash+gap-phase
            step = min(left, length-along)
            if visible:
                start = (a[0]+(b[0]-a[0])*along/length, a[1]+(b[1]-a[1])*along/length)
                end = (a[0]+(b[0]-a[0])*(along+step)/length, a[1]+(b[1]-a[1])*(along+step)/length)
                screenline([start, end], color, width)
            along += step
            phase = (phase+step) % (dash+gap)
            if abs(phase-(dash+gap)) < 1e-8:
                phase = 0

text(78, 45, '完整规划与本次选区', 42, '#353b39')
text(80, 108, f'源规划 {len(town["buildings"])} 栋  ·  本次 {len(selection["buildings"])} 栋 + 市场广场', 23)
text(1517, 118, f'SEED {selection["seed"]}  /  CORE {selection["generatorVersion"]}', 18, '#89877e', 'ra')
screenline([(80, 164), (1520, 164)], '#dedcd2', 1)

# Compact legend.
rounded_box((82, 184, 108, 204), '#d7d8d2', '#92978e', radius=2)
text(122, 178, '灰色：完整规划', 20)
rounded_box((375, 184, 401, 204), '#e5d2ad', '#9e8564', radius=2)
text(415, 178, '淡彩：本次 35 栋＋广场', 20)
dashed([(784, 195), (831, 195)], dash=9, gap=6)
text(844, 178, '虚线：样片范围', 20)
screenline([(1160, 195), (1208, 195)], '#4a5a57', 4)
text(1221, 178, '实线：原城墙', 20)

# A pale city enclosure gives the actual extent a stable visual reference.
for wall in town['walls']:
    if wall['kind'] == 'city':
        poly([vertices[v] for v in wall['boundary']], '#f0f0e9')
for district in town['districts']:
    if district.get('withinCity'):
        poly([vertices[v] for v in district['boundary']], '#f3f3ed', '#dedfd7', 0.7)

# Sample districts are highlighted while all footprint positions remain untouched.
district_colors = {'d14': '#eee2ca', 'd36': '#e6e7da', 'd37': '#f5e5bc'}
for district in selection['districts']:
    poly(district['points'], district_colors[district['id']], '#c9c4ae', 0.8)

for road in town['roads']:
    line([vertices[v] for v in road['vertexIds']], '#e4e2d8', max(1, road['width']*scale*0.52))

for building in town['buildings']:
    is_selected = building['id'] in selected_ids
    color = '#ddc8a3' if building['districtId'] == 'd14' else '#c9cbb5'
    poly([vertices[v] for v in building['boundary']], color if is_selected else '#d7d8d2',
         '#93856e' if is_selected else '#9da197', 0.9 if is_selected else 0.75)

for wall in town['walls']:
    points = [vertices[v] for v in wall['boundary']]
    for i, active in enumerate(wall['activeSegments']):
        if active:
            line([points[i], points[(i+1) % len(points)]], '#485b57', 4.2)
    for vid in wall['towerVertexIds']:
        x, y = p(vertices[vid])
        d.ellipse(((x-4.5)*S, (y-4.5)*S, (x+4.5)*S, (y+4.5)*S),
                  fill='#64746c', outline='#fbfaf6', width=S)

crop = [p(v) for v in selection['cropPolygon']]
dashed(crop+[crop[0]])

# Every original gate is visible. The two within the crop remain original gaps.
for gate in town['gates']:
    x, y = p(vertices[gate['vertexId']])
    d.ellipse(((x-7)*S, (y-7)*S, (x+7)*S, (y+7)*S),
              fill='#fbfaf6', outline='#617a72', width=2*S)

def callout(target, elbow, end, title, subtitle, side='left'):
    screenline([target, elbow, end], '#9ca59c', 1.3)
    tx = end[0]+12 if side == 'left' else end[0]-12
    anchor = 'la' if side == 'left' else 'ra'
    text(tx, end[1]-24, title, 23, '#3e514b', anchor)
    text(tx, end[1]+10, subtitle, 17, '#777b70', anchor)

callout(p(vertices['v433']), (1116, 618), (1192, 618), '真实城墙', '围合范围延伸到选区之外')
callout(p({'x': -80, 'y': -72}), (520, 738), (390, 738), 'd14 · 商业街区', '11 栋原有建筑', 'right')
callout(p({'x': 45, 'y': 64}), (1134, 935), (1210, 935), 'd36 · 作坊街区', '24 栋原有建筑')
callout(p(vertices['v22']), (780, 1125), (688, 1125), '城门', '沿用源规划的位置与缺口', 'right')
mx, my = p({'x': 35, 'y': -45})
text(mx, my-12, '市场广场', 23, '#806a43', 'mm')
text(mx, my+19, 'd37', 17, '#9d875d', 'mm')

rounded_box((80, 1236, 1520, 1345), '#eeede5', radius=12)
text(108, 1256, '凹形虚线是本次样片的裁切边界，并非整座城市的外形。', 24, '#4e594e')
text(108, 1300, '35 栋建筑的原始占地逐顶点保留；仅截取道路与城墙，未新增围墙。', 20, '#767d70')
im.resize((W, H), Image.Resampling.LANCZOS).save(OUT / 'planning-context.png')
print(OUT / 'planning-context.png')
