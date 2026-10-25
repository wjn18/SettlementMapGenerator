"""Fast isolated material study on the saved first version; never saves over it."""
import bpy, sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
OUT=HERE.parents[1]/'artifacts'/'3d-sample'
(OUT/'v2').mkdir(exist_ok=True)
sys.path.insert(0,str(HERE))
bpy.ops.wm.open_mainfile(filepath=str(OUT/'market-quarter.blend'))
from illustration_v2 import apply_illustration
print(apply_illustration(bpy.context.scene),flush=True)
s=bpy.context.scene;s.cycles.samples=16;s.render.resolution_x=1500;s.render.resolution_y=1500
for ls in s.view_layers[0].freestyle_settings.linesets:
    ls.linestyle.thickness*=.7
s.render.filepath=str(OUT/'v2'/'material-study.png')
bpy.ops.render.render(write_still=True)
