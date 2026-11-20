import {
  AmbientLight, Box3, BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide,
  Group, HemisphereLight, LineBasicMaterial, LineSegments, Material, Mesh, MeshStandardMaterial,
  OrthographicCamera, PCFShadowMap, Raycaster, Scene, Sphere, Texture, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { PackedMesh, XYZ } from './mesh.js';
import type { RiverScene } from './scene.js';
import type { Focus, FocusName, Library } from './placement.js';
import { architecturalKits } from './kit-view.js';

export interface ReferenceCamera { position: XYZ; direction: XYZ; span: number }
export type Framing = 'start' | 'bridge' | 'full' | FocusName;

function washMaterial() {
  const material = new MeshStandardMaterial({ vertexColors: true, side: DoubleSide, roughness: 1 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float pattern; varying float finish; varying vec3 inkPosition; varying vec3 faceNormal;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n inkPosition = position; finish=pattern; faceNormal=normal;');
    shader.fragmentShader = `
      varying vec3 inkPosition;
      varying float finish;
      varying vec3 faceNormal;
      float grainHash(vec3 p) { p = fract(p * .1031); p += dot(p, p.yzx + 33.33); return fract((p.x+p.y)*p.z); }
      float grain(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(mix(grainHash(i),grainHash(i+vec3(1,0,0)),f.x),mix(grainHash(i+vec3(0,1,0)),grainHash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(grainHash(i+vec3(0,0,1)),grainHash(i+vec3(1,0,1)),f.x),mix(grainHash(i+vec3(0,1,1)),grainHash(i+vec3(1)),f.x),f.y),f.z);
      }
    ` + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= .94 + .09 * grain(inkPosition*.8) + .035 * grain(inkPosition*3.0);
      if (finish > 3.5) {
        vec2 coord=inkPosition.xz*vec2(1.9,2.55);
        coord+=.17*vec2(grain(inkPosition*1.3),grain(inkPosition*1.9));
        vec2 aa=fwidth(coord);
        coord.x+=.5*mod(floor(coord.y),2.);
        vec2 d=abs(fract(coord+.5)-.5);
        vec2 mortar=1.-smoothstep(vec2(.018),vec2(.035)+aa,d);
        float tile=grainHash(vec3(floor(coord),12.))-.5;
        diffuseColor.rgb*=(1.+(tile*.105-max(mortar.x,mortar.y)*.09)*(1.-smoothstep(.18,.65,max(aa.x,aa.y))));
      } else if(finish > 2.5) {
        vec3 wave=vec3(inkPosition.x*.38,inkPosition.z*2.3,1.);
        float ripple=grain(wave+.75*grain(inkPosition*.33));
        diffuseColor.rgb+=vec3(.055,.075,.076)*smoothstep(.65,.83,ripple)*(1.-smoothstep(.18,.9,fwidth(wave.y)));
      } else if (finish > .5 && dot(faceNormal.xz,faceNormal.xz)>.001) {
        bool roof=finish<1.5;
        vec2 tangent=normalize(vec2(faceNormal.z,-faceNormal.x));
        float u=dot(inkPosition.xz,tangent)*(roof?2.15:1.22);
        float v=inkPosition.y*(roof?3.15:2.25)+grain(inkPosition*1.8)*.065;
        vec2 widths=max(vec2(.012),vec2(fwidth(u),fwidth(v)));
        vec2 uv=vec2(u+.5*mod(floor(v),2.),v);
        vec2 dist=abs(fract(uv+.5)-.5);
        vec2 joint=(1.-smoothstep(vec2(.023),vec2(.023)+widths,dist))*(1.-smoothstep(vec2(.23),vec2(.8),widths));
        float variation=(grainHash(vec3(floor(uv),3.))-.5)*(1.-smoothstep(.18,.7,max(widths.x,widths.y)));
        diffuseColor.rgb*=1.+variation*(roof?.19:.12)-max(joint.x*.7,joint.y)*(roof?.24:.18);
      }`);
  };
  return material;
}
function surface(data: PackedMesh, paint: Material, inkPaint: Material, cast: boolean) {
  const group = new Group(), geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
  geometry.setAttribute('color', new BufferAttribute(data.colors, 3));
  geometry.setAttribute('pattern',new BufferAttribute(data.patterns,1));
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, paint);
  mesh.castShadow = cast; mesh.receiveShadow = true; mesh.userData.sourceRanges = data.spans;
  group.add(mesh);
  if (data.ink.length) {
    const lines = new BufferGeometry();
    lines.setAttribute('position', new BufferAttribute(data.ink, 3));
    group.add(new LineSegments(lines, inkPaint));
  }
  return group;
}
function release(root: Group | Scene) {
  const materials = new Set<Material>(), textures = new Set<Texture>(), geometries = new Set<BufferGeometry>();
  root.traverse(object => {
    if (!(object instanceof Mesh || object instanceof LineSegments)) return;
    geometries.add(object.geometry);
    for (const m of Array.isArray(object.material) ? object.material : [object.material]) materials.add(m);
  });
  for (const m of materials) {
    for (const v of Object.values(m)) if (v instanceof Texture) textures.add(v);
    m.dispose();
  }
  for (const t of textures) { t.dispose(); t.source.data?.close?.(); }
  for (const g of geometries) g.dispose();
}

export function createRiverViewer(host: HTMLElement, city: RiverScene, reference: ReferenceCamera | null,
    propUrls: Record<'oak' | 'fountain' | Library, string>, onError: (message: string) => void) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  const canvas = renderer.domElement;
  canvas.tabIndex = 0; canvas.setAttribute('aria-label', '可旋转的三维河城，方向键旋转，加减键缩放');
  host.replaceChildren(canvas);
  const scene = new Scene(); scene.background = new Color('#f5edd9');
  const paint = washMaterial(), inkPaint = new LineBasicMaterial({ color: '#574f44', transparent: true, opacity: .6, depthWrite: false });
  paint.polygonOffset = true; paint.polygonOffsetFactor = 1; paint.polygonOffsetUnits = 1;
  const townSurface=surface(city.town,paint,inkPaint,true), kitRoot=new Group();
  scene.add(surface(city.terrain, paint, inkPaint, false), townSurface,kitRoot);
  const light = new DirectionalLight('#fff9f0', 1.7);
  const bounds = new Box3(new Vector3(...city.townBounds[0]), new Vector3(...city.townBounds[1]));
  const center = bounds.getCenter(new Vector3()), radius = Math.max(30, bounds.getBoundingSphere(new Sphere()).radius);
  light.target.position.copy(center); light.position.copy(center).addScaledVector(new Vector3(-.75, 1.35, -.48), radius * 2);
  Object.assign(light.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: .1, far: radius * 7 });
  light.shadow.camera.updateProjectionMatrix(); light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -.0003; light.shadow.normalBias = .06; light.castShadow = true;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
  scene.add(light, light.target, new HemisphereLight('#fffdf8', '#e9dfcc', 1.58), new AmbientLight('#ffffff', .52));

  const townBounds = new Box3().setFromArray(city.town.positions);
  if (townBounds.isEmpty()) townBounds.copy(bounds);
  const mapBounds = new Box3().setFromArray(city.terrain.positions).union(townBounds);
  const mapSpan = Math.max(50, mapBounds.getSize(new Vector3()).length());
  const orbitDistance = 2 * mapSpan;
  const camera = new OrthographicCamera(-1, 1, 1, -1, .1, 4 * mapSpan);
  const controls = new OrbitControls(camera, canvas);
  controls.minPolarAngle = .08; controls.maxPolarAngle = Math.PI * .47;
  // Every preset uses the same frustum, from a facade detail to the entire landscape.
  controls.minZoom = 1 / 2.25; controls.maxZoom = mapSpan / .35;
  controls.zoomSpeed = 1.6; controls.zoomToCursor = true;
  let fitTown = false, frame = 0, disposed = false, contextLost = false;
  let width = 1, height = 1;
  const kits=architecturalKits(kitRoot,city.mounts,propUrls,release,invalidate);
  const direction = new Vector3(-.47314679, .74314483, .47314679).normalize();
  const right = new Vector3().crossVectors(camera.up, direction).normalize();
  const up = new Vector3().crossVectors(direction, right);
  function overviewSpan(aspect: number) {
    const size = townBounds.getSize(new Vector3());
    const extent = (axis: Vector3) => Math.abs(axis.x) * size.x + Math.abs(axis.y) * size.y + Math.abs(axis.z) * size.z;
    return 1.12 * Math.max(1, extent(right) / Math.max(1, aspect), extent(up) * Math.min(1, aspect));
  }
  function projection(w: number, h: number) {
    const aspect = w / h;
    if (fitTown) camera.zoom = mapSpan / overviewSpan(aspect);
    camera.top = mapSpan * .5 / Math.min(1, aspect); camera.bottom = -camera.top;
    camera.right = camera.top * aspect; camera.left = -camera.right;
    camera.updateProjectionMatrix();
  }
  function draw() {
    frame = 0;
    if (!disposed && !contextLost) {
      kits.update(camera,height*renderer.getPixelRatio()); renderer.render(scene, camera);
    }
  }
  function invalidate() { if (!disposed && !frame && !contextLost) frame = requestAnimationFrame(draw); }
  function resize() {
    if (!host.clientWidth || !host.clientHeight) return;
    width = host.clientWidth; height = host.clientHeight;
    renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
    renderer.setSize(width, height, false); projection(width, height); invalidate();
  }
  function aim(target: Vector3, heading: Vector3, span?: number) {
    fitTown = span === undefined;
    controls.target.copy(target);
    camera.position.copy(target).addScaledVector(heading, orbitDistance);
    if (span !== undefined) camera.zoom = mapSpan / span;
    camera.lookAt(target); projection(width, height); controls.update(); invalidate();
  }
  function inspect(focus: Focus) {
    aim(new Vector3(...focus.target), new Vector3(...focus.direction).normalize(), focus.span);
  }
  function setView(mode: Framing) {
    if(mode!=='start' && mode!=='full' && mode!=='bridge') {
      const focus=city.focus[mode]; if(focus) inspect(focus); return;
    }
    if (mode === 'start' && reference) {
      const target = new Vector3(...reference.position);
      const dir = new Vector3(...reference.direction).normalize();
      target.addScaledVector(dir, -target.y / dir.y);
      aim(target, dir, reference.span);
    } else if (mode === 'bridge') {
      aim(new Vector3(...city.bridgeFocus), new Vector3(...city.bridgeViewDirection).normalize(), 72);
    } else {
      aim(townBounds.getCenter(new Vector3()), direction);
    }
  }
  const observer = new ResizeObserver(resize); observer.observe(host);
  controls.addEventListener('start', () => { fitTown = false; });
  controls.addEventListener('change', invalidate); resize(); setView('start');
  function key(event: KeyboardEvent) {
    const turn = { ArrowLeft: -.1, ArrowRight: .1 }[event.key as 'ArrowLeft' | 'ArrowRight'];
    if (turn) camera.position.sub(controls.target).applyAxisAngle(new Vector3(0, 1, 0), turn).add(controls.target);
    else if (['+', '=', '-'].includes(event.key)) camera.zoom = Math.max(controls.minZoom, Math.min(controls.maxZoom, camera.zoom * (event.key === '-' ? .82 : 1.22)));
    else return;
    fitTown = false; event.preventDefault(); camera.updateProjectionMatrix(); controls.update(); invalidate();
  }
  canvas.addEventListener('keydown', key);
  function pick(event: MouseEvent) {
    const box=canvas.getBoundingClientRect(), ray=new Raycaster();
    const mouse=new Vector2((event.clientX-box.left)*2/box.width-1,1-(event.clientY-box.top)*2/box.height);
    ray.setFromCamera(mouse,camera);
    const hit=ray.intersectObject(townSurface.children[0],false)[0];
    if(hit?.faceIndex==null) return;
    const i=hit.faceIndex*3, source=city.town.spans.find(s=>i>=s.start && i<s.start+s.count);
    const focus = source && (city.buildings[source.id] ?? city.gates[source.id] ?? city.towers[source.id]);
    if (focus) inspect(focus);
  }
  canvas.addEventListener('dblclick',pick);
  const lost = (e: Event) => { e.preventDefault(); contextLost = true; onError('图形上下文中断，恢复后将重新绘制。'); };
  const restored = () => { contextLost = false; renderer.shadowMap.needsUpdate = true; onError(''); invalidate(); };
  canvas.addEventListener('webglcontextlost', lost); canvas.addEventListener('webglcontextrestored', restored);

  // Only fetch kits used in this town. A late optional asset cannot resurrect a closed scene.
  const loader = new GLTFLoader();
  const propsReady = Promise.all([...new Set(city.props.map(p => p.type))].map(async type => {
    try {
      const model = (await loader.loadAsync(propUrls[type])).scene;
      if (disposed) { release(model); return; }
      const box = new Box3().setFromObject(model), size = box.getSize(new Vector3()), base = box.getCenter(new Vector3());
      for (const prop of city.props.filter(p => p.type === type)) {
        const asset = model.clone(true);
        const widthScale = prop.size / Math.max(.01, size.x, size.z);
        const scale = prop.type === 'oak' ? Math.min(widthScale, prop.maxHeight / Math.max(.01, size.y)) : widthScale;
        asset.scale.multiplyScalar(scale);
        asset.position.set(prop.position[0] - base.x * scale, prop.position[1] - box.min.y * scale, prop.position[2] - base.z * scale);
        asset.traverse(object => { if (object instanceof Mesh) { object.castShadow = true; object.receiveShadow = true; } });
        scene.add(asset);
        townBounds.expandByObject(asset);
      }
      renderer.shadowMap.needsUpdate = true; invalidate();
    } catch { if (!disposed) onError('部分广场或植被素材加载失败，基础城镇仍可浏览。'); }
  }));
  const assetsReady=Promise.all([propsReady,kits.ready]).then(() => {
    if (disposed) return;
    townBounds.union(kits.bounds);
    if (fitTown) setView('full');
  });
  void assetsReady.catch(err=>{if(!disposed) onError('建筑构件加载失败。'+String(err));});
  return {
    setView,assetsReady,
    inspectJunction(id: string) {
      if (!Object.hasOwn(city.junctionCenters,id)) return false;
      inspect({target:city.junctionCenters[id],direction:[.06,3.9,.39],span:29});
      return true;
    },
    async exportPNG(longSide=1500) {
      await assetsReady;
      if (disposed || contextLost) throw new Error('当前画布不可用，请重新打开河城。');
      const w = Math.round(longSide * width / Math.max(width, height)), h = Math.round(longSide * height / Math.max(width, height));
      const gl=renderer.getContext(), viewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
      if(w>viewport[0] || h>viewport[1] || longSide>gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) {
        throw new Error('设备不支持此导出尺寸，请选择 1500 px。');
      }
      try {
        renderer.setPixelRatio(1); renderer.setSize(w, h, false); projection(w, h);
        kits.update(camera,h); renderer.render(scene, camera);
        return await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG 导出失败，请重试。')), 'image/png'));
      } finally { if (!disposed) resize(); }
    },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
      canvas.removeEventListener('keydown', key); canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('webglcontextrestored', restored);
      canvas.removeEventListener('dblclick',pick);
      kits.dispose(); light.shadow.dispose(); release(scene); renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    },
  };
}
