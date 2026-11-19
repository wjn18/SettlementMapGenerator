"""Pack authored static GLBs into instancing libraries with one texture atlas per library."""
from io import BytesIO
import hashlib
import json
import math
from pathlib import Path
import struct

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "apps/playground/src/river-pilot/assets/kits"
GROUPS = {
    "joinery": ("small-town", [
        *(f"opening_0{i}" for i in range(1, 7)), *(f"timber_panel_0{i}" for i in range(1, 5)),
        "dormer_01", "dormer_02", "dormer_03", "patriciate_facade_01", "patriciate_facade_02",
        "sign_bakery_01", "sign_cobbler_01", "sign_draper_01", "sign_grocer_01", "sign_potter_01", "sign_smith_01", "sign_tavern_01",
        "farm_barn_01:facade_and_shelter", "farm_cottage_01:facade_and_shelter"]),
    "church": ("small-town", ["cathedral_belfry_01", "cathedral_openings_01:lancet_window", "cathedral_openings_01:pointed_door", "gate_arch_trim_01", "gate_arch_trim_02", "gate_hardware_01"]),
    "castle": ("castle", ["castle_keep_openings_01:entrance", "castle_keep_openings_01:arrow_loop", "castle_keep_turret_01"]),
    "market": ("small-town", [
        "citizen_merchant_01", "citizen_basket_01", "citizen_walking_01", "citizen_carrying_01",
        "goods_food_01", "goods_pottery_01", "goods_cloth_01", "goods_iron_01", "bench_01", "firewood_01",
        "fountain_ornament_01", "water_flow_01"]),
    "harbor": ("harbor", [
        "harbor_rowboat_01", "harbor_river_cargo_01", "harbor_cargo_lugger_01", "harbor_cargo_ketch_01",
        "harbor_cargo_sloop_01", "harbor_fishing_boat_01", "harbor_merchant_ship_01",
        "harbor_warehouse_door_01", "harbor_warehouse_hoist_01", "harbor_bollard_01", "harbor_quay_01", "harbor_quay_steps_01"]),
}
DT = {5121:"u1", 5123:"<u2", 5125:"<u4", 5126:"<f4"}
SIZE = {"SCALAR":1,"VEC2":2,"VEC3":3,"VEC4":4}
TILE, PAD = 128, 4

def read_glb(path):
    raw = path.read_bytes()
    n = struct.unpack_from("<I", raw, 12)[0]
    return json.loads(raw[20:20+n]), raw[28+n:]

def view(doc, binary, idx):
    v = doc["bufferViews"][idx]
    start = v.get("byteOffset", 0)
    return binary[start:start+v["byteLength"]]

def accessor(doc, binary, idx):
    a = doc["accessors"][idx]
    v = doc["bufferViews"][a["bufferView"]]
    dtype = np.dtype(DT[a["componentType"]])
    cols = SIZE[a["type"]]
    return np.ndarray((a["count"],cols),dtype,buffer=binary,
        offset=v.get("byteOffset",0)+a.get("byteOffset",0),
        strides=(v.get("byteStride",cols*dtype.itemsize),dtype.itemsize))

def pack(group, source, selection, catalog):
    folder = ROOT / "artifacts" / (source + "-assets")
    entries = {v["id"]:v for v in json.loads((folder/"asset-library.json").read_text(encoding="utf-8-sig"))["assets"]}
    data = bytearray()
    out = {"asset":{"version":"2.0","generator":"Settlement Web Kit"}, "scene":0,"scenes":[{"nodes":[]}],
           "nodes":[],"meshes":[],"materials":[{"pbrMetallicRoughness":{"baseColorTexture":{"index":0},"metallicFactor":0,"roughnessFactor":.92},"doubleSided":True}],
           "textures":[{"source":0}], "accessors":[], "bufferViews":[]}
    def append(blob):
        data.extend(bytes((-len(data))%4))
        out["bufferViews"].append({"buffer":0,"byteOffset":len(data),"byteLength":len(blob)})
        data.extend(blob)
        return len(out["bufferViews"])-1
    def attribute(array, kind, component, bounds=False):
        array = np.ascontiguousarray(array,dtype=DT[component])
        item = {"bufferView":append(array.tobytes()),"componentType":component,"count":len(array),"type":kind}
        if bounds:
            item.update(min=array.min(axis=0).tolist(),max=array.max(axis=0).tolist())
        out["accessors"].append(item)
        return len(out["accessors"])-1
    tiles = {}
    for token in selection:
        asset, _, role = token.partition(":")
        key = token.replace(":", "__")
        doc, binary = read_glb(folder/"glb"/(asset+".glb"))
        points, normals, uvs, cells, indices = [], [], [], [], []
        count = 0
        for node in doc["nodes"]:
            if "mesh" not in node or (role and node.get("extras",{}).get("part_role") != role): continue
            if any(k in node for k in ("matrix","scale","translation","rotation")):
                raise ValueError(f"Unbaked mesh transform in {key}")
            for prim in doc["meshes"][node["mesh"]]["primitives"]:
                a = prim["attributes"]
                p = accessor(doc,binary,a["POSITION"])
                mat = doc["materials"][prim["material"]]["pbrMetallicRoughness"]
                tex = doc["textures"][mat["baseColorTexture"]["index"]]
                img = view(doc,binary,doc["images"][tex["source"]]["bufferView"])
                digest = hashlib.sha256(img).digest()
                if digest not in tiles: tiles[digest] = (len(tiles), img)
                points.append(p); normals.append(accessor(doc,binary,a["NORMAL"])); uvs.append(accessor(doc,binary,a["TEXCOORD_0"]))
                cells.append(np.full((len(p),1),tiles[digest][0],dtype=np.float32))
                indices.append(accessor(doc,binary,prim["indices"]).astype(np.uint32).ravel()+count)
                count += len(p)
        if not points: raise ValueError(f"Missing kit part {key}")
        pos = np.concatenate(points)
        lo, hi = pos.min(axis=0), pos.max(axis=0)
        meta = entries[asset]
        # Preserve native boat origin at waterline. Wall-mounted parts have their
        # rear plane at z=0, ground-mounted parts have their feet centered at y=0.
        offset = (lo+hi)*.5
        offset[1] = lo[1]
        if meta["mountPlane"] == "WALL_XZ": offset[2] = lo[2]
        # Gate trim and ironwork share the authored threshold and hinge plane.
        if "hullProfile" in meta or meta["mountPlane"] == "GATE_XZ": offset[:] = 0
        node_id = len(out["nodes"]); out["scenes"][0]["nodes"].append(node_id)
        out["nodes"].append({"mesh":node_id,"name":key})
        attr = {k:attribute(arr,kind,5126,k=="POSITION") for k,arr,kind in [
            ("POSITION",pos-offset,"VEC3"),("NORMAL",np.concatenate(normals),"VEC3"),("TEXCOORD_0",np.concatenate(uvs),"VEC2"),("_TILE",np.concatenate(cells),"SCALAR")]}
        out["meshes"].append({"name":key,"primitives":[{"attributes":attr,"indices":attribute(np.concatenate(indices),"SCALAR",5123 if count<65536 else 5125),"material":0}]})
        record = {"library":group,"size":[round(float(v),5) for v in hi-lo]}
        if "hullProfile" in meta: record["hull"] = meta["hullProfile"]
        catalog[key] = record
    grid = math.ceil(math.sqrt(len(tiles))); step = TILE+2*PAD
    atlas = Image.new("RGB",(grid*step,grid*step))
    for i,img in tiles.values():
        image = Image.open(BytesIO(img)).convert("RGB").resize((TILE,TILE),Image.Resampling.LANCZOS)
        tile = np.pad(np.asarray(image),((PAD,PAD),(PAD,PAD),(0,0)),mode="wrap")
        atlas.paste(Image.fromarray(tile),((i%grid)*step,(i//grid)*step))
    encoded = BytesIO(); atlas.save(encoded,format="PNG",optimize=True)
    out["images"]=[{"bufferView":append(encoded.getvalue()),"mimeType":"image/png"}]
    out["scenes"][0]["extras"]={"atlasGrid":grid,"atlasTile":TILE,"atlasPad":PAD}
    data.extend(bytes((-len(data))%4)); out["buffers"]=[{"byteLength":len(data)}]
    info=json.dumps(out,separators=(",",":")).encode(); info+=b" "*((-len(info))%4)
    (DEST/(group+".glb")).write_bytes(struct.pack("<4sII",b"glTF",2,28+len(info)+len(data))+struct.pack("<I4s",len(info),b"JSON")+info+struct.pack("<I4s",len(data),b"BIN\0")+data)

if __name__ == "__main__":
    DEST.mkdir(exist_ok=True,parents=True)
    kits = {}
    for group,(source,selection) in GROUPS.items(): pack(group,source,selection,kits)
    ts = "// Generated by scripts/prepare-three-kits.py from the authored asset libraries.\nexport const kitCatalog = {\n"
    ts += "".join(f"  {json.dumps(k)}: {json.dumps(v,separators=(',',':'))},\n" for k,v in kits.items())
    (ROOT/"packages/renderer-three/src/kit-catalog.ts").write_text(ts+"} as const;\n",encoding="utf-8")
