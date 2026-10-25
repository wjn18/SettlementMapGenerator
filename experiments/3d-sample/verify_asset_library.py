"""Independent saved-library + GLB round-trip checks (run with Blender)."""
import bpy,json,math,struct,hashlib
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE=Path(__file__).resolve().parent
OUT=HERE.parents[1]/'artifacts'/'small-town-assets'
manifest=json.loads((OUT/'asset-library.json').read_text(encoding='utf-8'))
results=[]
failures=[]


def require(condition,message):
    if not condition:failures.append(message)


def bounds(objects):
    pts=[o.matrix_world@v.co for o in objects if o.type=='MESH' for v in o.data.vertices]
    return {'min':[min(p[i] for p in pts) for i in range(3)],'max':[max(p[i] for p in pts) for i in range(3)]}


scene=bpy.data.scenes.new('INDEPENDENT GLB CHECK')
bpy.context.window.scene=scene
for entry in manifest['assets']:
    path=OUT/entry['file'];raw=path.read_bytes()
    magic,version,length=struct.unpack_from('<4sII',raw)
    require((magic,version,length)==(b'glTF',2,len(raw)),entry['id']+': invalid GLB header')
    size,kind=struct.unpack_from('<II',raw,12)
    gltf=json.loads(raw[20:20+size])
    require(hashlib.sha256(raw).hexdigest()==entry['sha256'],entry['id']+': file hash mismatch')
    require(all('uri' not in img and 'bufferView' in img for img in gltf.get('images',[])),entry['id']+': external image reference')
    require(all('uri' not in b for b in gltf.get('buffers',[])),entry['id']+': external buffer')
    require(all(n.get('name')!='Cube' for n in gltf['nodes']),entry['id']+': unrelated default mesh exported')
    coll=bpy.data.collections[entry['collection']]
    roots=[o for o in coll.objects if o.name.endswith('__ROOT')]
    require(len(roots)==1 and roots[0].location.length<1e-8,entry['id']+': invalid root origin')
    require(coll.asset_data is not None,entry['id']+': missing Blender collection asset metadata')
    for ob in coll.objects:
        if ob.type!='MESH':continue
        require(ob.data.uv_layers.active is not None,ob.name+': no UV map')
        require(all(math.isfinite(v) for vertex in ob.data.vertices for v in vertex.co),ob.name+': nonfinite geometry')
        require([m.get('semantic_slot') for m in ob.data.materials]==manifest['materialSlots'],ob.name+': semantic material order mismatch')
        for mat in ob.data.materials:
            textures=[n.image for n in mat.node_tree.nodes if n.type=='TEX_IMAGE' and n.image]
            require(all(i.packed_file for i in textures),mat.name+': unpacked image')
    bpy.ops.import_scene.gltf(filepath=str(path))
    bpy.context.view_layer.update()
    imported=list(scene.objects)
    meshes=[o for o in imported if o.type=='MESH']
    require(len(meshes)==len(entry['parts']),entry['id']+': round-trip mesh count mismatch')
    actual=bounds(meshes)
    error=max(abs(actual[k][i]-entry['bounds'][k][i]) for k in ('min','max') for i in range(3))
    require(error<1e-5,entry['id']+': round-trip metric bounds changed by '+str(error))
    # Check real triangle intersections through the central passage, not only vertices.
    clearance=None
    if entry['id'].startswith('gate_'):
        clear=True
        for ob in meshes:
            tree=BVHTree.FromPolygons([ob.matrix_world@v.co for v in ob.data.vertices],[list(p.vertices) for p in ob.data.polygons])
            for x in (-1.5,-.75,0,.75,1.5):
                for z in (.25,.75,1.5,2.25,2.75):
                    if tree.ray_cast(Vector((x,-.8,z)),Vector((0,1,0)),1.6)[0] is not None:clear=False
        require(clear,entry['id']+': central passage blocked')
        clearance={'sampledWidth':3,'sampledHeightRange':[.25,2.75],'sampledDepth':1.6,'passed':clear}
    results.append({'assetId':entry['id'],'roundTripBoundsErrorMeters':error,'meshes':len(meshes),
                    'embeddedTextureCount':len(gltf.get('images',[])),'bytes':len(raw),'passageCheck':clearance,
                    'passed':error<1e-5})
    for ob in imported:
        mesh=ob.data if ob.type=='MESH' else None
        bpy.data.objects.remove(ob,do_unlink=True)
        if mesh and mesh.users==0:bpy.data.meshes.remove(mesh)
    print('CHECKED '+entry['id'],flush=True)

require(len(manifest['assets'])==61,'Expected 61 variants')
require(len(manifest['requirements'])==11,'Expected 11 required groups')
require(all(r['requiredVariants']==r['deliveredVariants'] for r in manifest['requirements']),'Variant count mismatch')
report={'passed':not failures,'checkedAssets':len(results),'checkedGroups':len(manifest['requirements']),
        'librarySha256':hashlib.sha256((OUT/'small-town-asset-library.blend').read_bytes()).hexdigest(),
        'checks':['GLB headers and checksums','embedded textures and buffers','asset metadata and root origins',
                  'semantic material slots and packed Blender images','finite geometry and UVs',
                  'all 61 GLB imports, mesh counts and metric bounding boxes','gate passage triangle ray tests'],
        'maxRoundTripBoundsErrorMeters':max(r['roundTripBoundsErrorMeters'] for r in results),
        'assets':results,'failures':failures,
        'limitations':'Static stylized assets; no rigging, LODs, collision proxies, navigation or whole-town replacement validation.'}
(OUT/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'passed':report['passed'],'assets':len(results),'failures':failures},ensure_ascii=False),flush=True)
assert not failures,failures
