import type { Gate, Wall } from '@settlement/core';
import { ShapeUtils } from 'three';
import { at, MeshBatch, point, strip, world, type XY, type XYZ } from './mesh.js';
import { faceYaw, mount, type Focus, type Mount } from './placement.js';

function buildGatehouse(mesh: MeshBatch, mounts: Mount[], id: string, a: XY, b: XY,
    normal: XY, wallHeight: number, pointed: boolean): Focus {
  const center = at(a, b, .5), width = a.distanceTo(b), half = width / 2;
  const axis = b.clone().sub(a).normalize();
  const plan = (x: number, depth: number) => center.clone().addScaledVector(axis, x).addScaledVector(normal, depth);
  const xyz = (x: number, depth: number, h: number) => world(plan(x, depth), h);
  const pier = Math.min(2.1, width * .35), crown = wallHeight + 2.1, tower = crown + 2.5;
  const depth = 1.65, stretch: XYZ = [width / 4, 1.25, 1];
  mesh.entity(id, () => {
    const block = (left: number, right: number, halfDepth: number, base: number, top: number, paint: string) =>
      mesh.prism(strip(plan(left, 0), plan(right, 0), halfDepth), base, top, paint, true, 2);
    for (const side of [-1, 1]) {
      const x = side * (half + pier / 2);
      block(x - pier / 2, x + pier / 2, depth + .28, 0, tower, '#b1a28b');
      block(x - pier / 2 - .14, x + pier / 2 + .14, depth + .42, tower - .34, tower, '#d0bfa4');
      for (const end of [-1, 1]) {
        mesh.prism(strip(plan(x - pier / 2, end * depth), plan(x + pier / 2, end * depth), .36),
          tower, tower + .85, '#bcae96', true, 2);
      }
    }
    // Use the same spring line and curve as the authored pointed/round stone surround.
    const archHeight = (x: number) => {
      const u = Math.abs(x) / half;
      const arc = pointed ? Math.sqrt(Math.max(0, 16 - (2 + 2 * u) ** 2)) : 2 * Math.sqrt(Math.max(0, 1 - u * u));
      return -.1 + (3.2 + arc) * stretch[1];
    };
    const stones = ['#c3b297', '#d0bea0', '#bdaa90'];
    for (let i = 0; i < 20; i++) {
      // Sample more densely near the vertical springing at either pier.
      const x0 = -half * Math.cos(i * Math.PI / 20), x1 = -half * Math.cos((i + 1) * Math.PI / 20);
      const h0 = archHeight(x0), h1 = archHeight(x1);
      for (const side of [-1, 1]) {
        const d = side * depth, face = d + side * .075;
        mesh.quad(xyz(x0,d,h0+.54), xyz(x1,d,h1+.54), xyz(x1,d,crown), xyz(x0,d,crown), '#b7a991', 2);
        mesh.quad(xyz(x0,face,h0), xyz(x1,face,h1), xyz(x1,d,h1+.54), xyz(x0,d,h0+.54), stones[i % 3]);
        mesh.line(xyz(x0,face,h0), xyz(x0,d,h0+.54));
      }
      mesh.quad(xyz(x0,-depth-.075,h0), xyz(x1,-depth-.075,h1), xyz(x1,depth+.075,h1), xyz(x0,depth+.075,h0), '#9e917d');
    }
    block(-half, half, depth + .15, crown - .25, crown + .12, '#caba9e');
    const teeth = Math.max(2, Math.round(width / 2.1));
    for (let i = 0; i < teeth; i++) {
      block(-half + (i + .2) * width / teeth, -half + (i + .75) * width / teeth,
        depth, crown + .12, crown + .9, '#b9aa91');
    }
  });
  const yaw = faceYaw(normal);
  mounts.push(mount(pointed ? 'gate_arch_trim_01' : 'gate_arch_trim_02', id, plan(0, depth + .15), -.1, yaw, stretch));
  mounts.push(mount('gate_hardware_01', id, plan(0, depth - .09), .04, yaw, stretch));
  return { target: world(center, tower * .48), direction: world(normal.clone().addScaledVector(axis, .30), .44),
    span: Math.max(24, width + pier * 2 + 9) };
}

export function buildWallGates(mesh: MeshBatch, mounts: Mount[], wall: Wall, gates: Gate[],
    vertex: (id: string) => XY, wallHeight: number) {
  const insets = new Map<string, number>();
  const views: Record<string, Focus> = {};
  const ids = wall.boundary, n = ids.length;
  if (!gates.length || !wall.activeSegments.some(Boolean)) return { insets, views };
  const ring = ids.map(vertex), winding = Math.sign(ShapeUtils.area(ring)) || 1;
  const used = new Set<number>();
  for (const gate of gates) {
    const i = ids.indexOf(gate.vertexId);
    if (i < 0) continue;
    let left = i, right = i;
    while (!wall.activeSegments[(left + n - 1) % n]) left = (left + n - 1) % n;
    while (!wall.activeSegments[right]) right = (right + 1) % n;
    if (used.has(left)) continue;
    let a = ring[left], b = ring[right];
    if (left === right) {
      // Older plans record the gate on two solid adjoining wall segments.
      const p = ring[i], prev = ring[(i + n - 1) % n], next = ring[(i + 1) % n];
      const inset = Math.min(3, p.distanceTo(prev), p.distanceTo(next));
      if (inset < .001) continue;
      a = at(p, prev, inset / p.distanceTo(prev)); b = at(p, next, inset / p.distanceTo(next));
      insets.set(gate.vertexId, inset);
    }
    if (a.distanceToSquared(b) < .000001) continue;
    const exterior = point(b.y - a.y, a.x - b.x).normalize().multiplyScalar(winding);
    views[gate.id] = buildGatehouse(mesh, mounts, gate.id, a, b, exterior, wallHeight, used.size % 2 === 0);
    used.add(left);
  }
  return { insets, views };
}
