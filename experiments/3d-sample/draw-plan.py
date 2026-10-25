"""Rasterize the selected planning data without changing its geometry."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts'/'3d-sample'
s=json.loads((OUT/'selection.json').read_text(encoding='utf-8'))
S=2
im=Image.new('RGB',(1400*S,1320*S),'#faf8f1')
d=ImageDraw.Draw(im)
font_path='C:/Windows/Fonts/arial.ttf'
def font(n): return ImageFont.truetype(font_path,n*S)
bb=s['bounds']; scale=min(1200/(bb['maxX']-bb['minX']),1075/(bb['maxY']-bb['minY']))
def p(v): return ((100+(v['x']-bb['minX'])*scale)*S,(130+(v['y']-bb['minY'])*scale)*S)
def poly(ps,fill,outline=None,width=.6):
    pts=[p(v) for v in ps]; d.polygon(pts,fill=fill)
    if outline:d.line(pts+[pts[0]],fill=outline,width=max(1,round(width*scale*S)),joint='curve')
def line(ps,fill,width):d.line([p(v) for v in ps],fill=fill,width=max(1,round(width*scale*S)),joint='curve')
d.text((100*S,35*S),'PLANNING SAMPLE / 35 ORIGINAL BUILDINGS',font=font(28),fill='#3e372d')
d.text((100*S,80*S),'Seed 7  |  Core '+s['generatorVersion']+'  |  Original footprints, roads, plaza and city-wall segments',font=font(18),fill='#756953')
poly(s['cropPolygon'],'#ece4d3','#b2a591')
colors={'MerchantWard':'#b9b3a5','CraftsmenWard':'#d1bea0','Market':'#f4dda5'}
for x in s['districts']:poly(x['points'],colors[x['wardType']] if x['wardType']=='Market' else '#f2eddf','#c4b9a5',.2)
for r in s['roads']:line(r['points'],'#d7c7aa',r['width'])
for b in s['buildings']:poly(b['points'],colors[b['wardType']],'#443c31',.5)
for w in s['walls']:
    for i,active in enumerate(w['activeSegments']):
        if active:line(w['points'][i:i+2],'#5e564b',2.8)
    for q in w['towerPoints']:
        x,y=p(q);r=3.6*scale*S;d.ellipse((x-r,y-r,x+r,y+r),fill='#b8afa0',outline='#453c31',width=2*S)
    for q in w['gatePoints']:
        x,y=p(q);r=4*scale*S;d.ellipse((x-r,y-r,x+r,y+r),fill='#f9f3e2',outline='#9a7548',width=2*S)
for f in s['features']:poly(f['points'],'#b6aa8f','#453c31',.5)
for b in s['buildings']:
    center={k:sum(v[k] for v in b['points'])/len(b['points']) for k in ('x','y')}
    d.text(p(center),b['id'],font=font(11),fill='#372f25',anchor='mm')
d.text(p({'x':34,'y':-38}),'MARKET',font=font(24),fill='#8a7049',anchor='mm')
d.text(p({'x':34,'y':-31}),'d37',font=font(16),fill='#8a7049',anchor='mm')
d.text((100*S,1230*S),'d14  Merchant ward: 11 buildings     d36  Craftsmen ward: 24 buildings     d37  Market plaza',font=font(19),fill='#554a39')
d.text((100*S,1265*S),'All selected buildings are complete. No building inside the crop is omitted. Wall gaps are original gates.',font=font(17),fill='#756953')
im.resize((1400,1320),Image.Resampling.LANCZOS).save(OUT/'planning-selection.png')
print(OUT/'planning-selection.png')
