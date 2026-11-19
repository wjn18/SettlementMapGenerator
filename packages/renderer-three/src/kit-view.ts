import {
  Box3, DynamicDrawUsage, Frustum, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial,
  Object3D, OrthographicCamera, ShaderChunk, Sphere, Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { kitCatalog } from './kit-catalog.js';
import type { Kit, Library, Mount } from './placement.js';

// Each atlas cell retains the repeating UVs of the authored Blender material.
function useAtlas(material: MeshStandardMaterial, grid: number, tile: number, pad: number) {
  const cell = tile + 2 * pad, atlas = grid * cell;
  material.customProgramCacheKey = () => 'town-atlas-' + [grid, tile, pad].join('-');
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float _tile; varying vec2 atlasCell;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\n atlasCell = vec2(mod(_tile, '+grid+'.0),floor(_tile/'+grid+'.0));');
    const sample = 'textureGrad(map,(atlasCell*'+cell+'.0+'+pad+'.0+fract(vMapUv)*'+tile+'.0)/'+atlas+
      '.0,dFdx(vMapUv)*'+(tile/atlas)+',dFdy(vMapUv)*'+(tile/atlas)+')';
    shader.fragmentShader = 'varying vec2 atlasCell;\n' + shader.fragmentShader.replace('#include <map_fragment>',
      ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', sample));
  };
}
interface Cell { sphere: Sphere; detail: number; matrices: Matrix4[]; visible: boolean }
export function architecturalKits(root: Group, mounts: Mount[], urls: Record<Library,string>,
    release: (g: Group) => void, redraw: () => void) {
  let disposed = false;
  const batches: {mesh: InstancedMesh; cells: Cell[]}[] = [];
  const loader = new GLTFLoader(), transform = new Object3D(), frustum = new Frustum(), projection = new Matrix4();
  const bounds = new Box3(), placedBounds = new Box3();
  const groups = new Map<Kit, Mount[]>();
  for (const item of mounts) {
    const entries = groups.get(item.kit);
    if (entries) entries.push(item); else groups.set(item.kit,[item]);
  }
  const sources: Group[] = [];
  const ready = Promise.all([...new Set([...groups.keys()].map(k=>kitCatalog[k].library))].map(async library => {
    const source = (await loader.loadAsync(urls[library])).scene;
    if (disposed) { release(source); return; }
    sources.push(source);
    const {atlasGrid,atlasTile,atlasPad}=source.userData;
    for (const [kit, placements] of groups) {
      if (kitCatalog[kit].library !== library) continue;
      const part = source.getObjectByName(kit);
      if (!(part instanceof Mesh) || !part.geometry.hasAttribute('_tile')) throw new Error('缺少建筑构件 '+kit);
      part.geometry.computeBoundingBox();
      useAtlas(part.material,atlasGrid,atlasTile,atlasPad);
      const mesh = new InstancedMesh(part.geometry,part.material,placements.length);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage); mesh.frustumCulled=false;
      mesh.receiveShadow=true; mesh.count=0; mesh.name=kit; root.add(mesh);
      const cells = new Map<string, Cell>();
      for (const p of placements) {
        const x=Math.floor(p.position[0]/24), z=Math.floor(p.position[2]/24);
        const key=[x,z,p.detail].join('/');
        let cell=cells.get(key);
        if (!cell) {
          cell={sphere:new Sphere(new Vector3(x*24+12,8,z*24+12),32),detail:p.detail,matrices:[],visible:false};
          cells.set(key,cell);
        }
        transform.position.set(...p.position); transform.rotation.set(0,p.yaw,0); transform.scale.set(...p.scale);
        transform.updateMatrix(); cell.matrices.push(transform.matrix.clone());
        bounds.union(placedBounds.copy(part.geometry.boundingBox!).applyMatrix4(transform.matrix));
      }
      batches.push({mesh,cells:[...cells.values()]});
    }
    redraw();
  }));
  return {
    ready, bounds,
    update(camera: OrthographicCamera, height: number) {
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
      const density=height*camera.zoom/(camera.top-camera.bottom);
      for (const {mesh,cells} of batches) {
        let changed=false;
        for (const cell of cells) {
          const visible=density >= [0,3.1,6.0][cell.detail] && frustum.intersectsSphere(cell.sphere);
          changed ||= visible !== cell.visible; cell.visible=visible;
        }
        if (!changed) continue;
        let count=0;
        for (const cell of cells) if (cell.visible) for(const matrix of cell.matrices) mesh.setMatrixAt(count++,matrix);
        mesh.count=count; mesh.visible=count>0; mesh.instanceMatrix.needsUpdate=true;
      }
    },
    dispose() {
      disposed=true;
      for (const {mesh} of batches) { root.remove(mesh); mesh.dispose(); }
      for (const source of sources) release(source);
    },
  };
}
