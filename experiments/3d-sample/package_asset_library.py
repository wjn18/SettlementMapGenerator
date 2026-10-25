"""Compose an index of Blender renders and package the delivered 3D assets."""
import json,hashlib,zipfile
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont

HERE=Path(__file__).resolve().parent
OUT=HERE.parents[1]/'artifacts'/'small-town-assets'
manifest=json.loads((OUT/'asset-library.json').read_text(encoding='utf-8'))
names=[('01_cathedral','教堂组件',4),('02_fountain','喷泉组件',4),('03_vegetation','树木与灌木',5),
       ('04_farm','农舍与仓棚',2),('05_patriciate','富裕住宅',2),('06_roof','屋脊、檐口与屋顶窗',6),
       ('07_facade','木构与门窗',10),('08_goods_signs','商品与行业招牌',12),('09_citizens','静态人物',8),
       ('10_gate','门楼饰件与开启硬件',3),('11_courtyard','地面与庭院小物',5)]
font_path='C:/Windows/Fonts/msyh.ttc'
title_font=ImageFont.truetype(font_path,42)
head_font=ImageFont.truetype(font_path,29)
body_font=ImageFont.truetype(font_path,22)
sheet=Image.new('RGB',(2460,2460),'#eee9dc');draw=ImageDraw.Draw(sheet)
draw.text((55,32),'小镇 · 三维可拼装素材库',font=title_font,fill='#322f26')
draw.text((57,94),'61 个模块 / 11 类 / Blender + GLB / 内嵌纹理',font=body_font,fill='#68604d')
for i,(file,title,count) in enumerate(names):
    x=30+(i%3)*810;y=150+(i//3)*565
    draw.rounded_rectangle((x,y,x+790,y+545),radius=13,fill='#fffdf2')
    draw.text((x+22,y+16),f'{i+1:02}  {title}  ·  {count}',font=head_font,fill='#514b3c')
    image=Image.open(OUT/'previews'/(file+'.png')).convert('RGB')
    if count<=4:image=image.crop((20,270,1580,1020))
    elif count<=8:image=image.crop((20,140,1580,1090))
    else:image=image.crop((20,80,1580,1120))
    image.thumbnail((760,465),Image.Resampling.LANCZOS)
    sheet.paste(image,(x+(790-image.width)//2,y+65+(465-image.height)//2))
x=30+2*810;y=150+3*565
draw.rounded_rectangle((x,y,x+790,y+545),radius=13,fill='#ded9c9')
draw.text((x+35,y+50),'交付内容',font=title_font,fill='#403c30')
for j,line in enumerate(('可编辑 .blend 素材库','61 个独立 .glb','30 张可平铺材质纹理','教堂 / 喷泉源规划装配示例','全部 GLB 回读与尺寸检查通过')):
    draw.text((x+38,y+140+j*65),line,font=head_font,fill='#514b3c')
draw.text((55,2414),'展示图中的缩放仅为排版；实际模型使用米制。人物为静态网格，装配规则见 README。',font=body_font,fill='#68604d')
sheet.save(OUT/'previews'/'all-assets.png')
files=[]
for path in sorted(OUT.rglob('*')):
    if not path.is_file() or path.suffix in ('.zip','.log','.blend1') or path.name=='delivery-checksums.json':continue
    if path.name.endswith('.blend2') or '.blend' in path.suffix and path.suffix!='.blend':continue
    files.append(path)
checksums={str(p.relative_to(OUT)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
(OUT/'delivery-checksums.json').write_text(json.dumps(checksums,indent=2),encoding='utf-8')
with zipfile.ZipFile(OUT/'small-town-assets.zip','w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    for path in files+[OUT/'delivery-checksums.json']:archive.write(path,path.relative_to(OUT))
print('PACKAGED',len(files),'files;',len(manifest['assets']),'3D kits')
