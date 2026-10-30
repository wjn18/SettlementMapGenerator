"""Package the saved stone keep kit without build logs or Blender backups."""
import hashlib
import json
import zipfile
from pathlib import Path

OUT=Path(__file__).resolve().parents[2]/'artifacts'/'castle-assets'
files=[p for p in sorted(OUT.rglob('*')) if p.is_file() and p.suffix not in ('.zip','.log','.blend1','.blend2') and p.name!='delivery-checksums.json']
checksums={str(p.relative_to(OUT)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
index=OUT/'delivery-checksums.json';index.write_text(json.dumps(checksums,indent=2),encoding='utf-8')
with zipfile.ZipFile(OUT/'castle-keep-assets.zip','w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    for p in files+[index]:archive.write(p,p.relative_to(OUT))
print('PACKAGED',len(files)+1,'files')
