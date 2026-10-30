"""Reject a near-black daylight result, while retaining normal dark shadows."""
import sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'experiments/3d-sample'))
from render_pipeline import check_render_brightness, RenderBrightnessError

normal=np.full((256,256,3),.82,dtype=np.float32)
normal[40:210,40:160]=.06
assert check_render_brightness(normal)['percentile95']>.8
for bad in (normal*.16,np.full_like(normal,.15),np.full_like(normal,np.nan)):
    try:check_render_brightness(bad)
    except RenderBrightnessError:pass
    else:raise AssertionError('Abnormally dark or corrupt output was accepted')
print('RENDER_BRIGHTNESS_TEST_PASS',flush=True)
