import { Color, ShapeUtils, Vector2 } from 'three';
import type { Pair, Polygon } from 'polygon-clipping';

export type XY = Vector2;
export type XYZ = [number, number, number];
export const point = (x: number, y: number) => new Vector2(x, y);
export const world = (p: XY, h = 0): XYZ => [p.x, h, -p.y];
export const at = (a: XY, b: XY, t: number) => a.clone().lerp(b, t);
export const pair = (p: XY): Pair => [p.x, p.y];
export function mean(points: XY[]) {
  return points.reduce((sum, p) => sum.add(p), point(0, 0)).divideScalar(points.length);
}
export function circle(c: XY, radius: number, sides: number): XY[] {
  return Array.from({ length: sides }, (_, i) => {
    const angle = i * 2 * Math.PI / sides;
    return point(c.x + radius * Math.cos(angle), c.y + radius * Math.sin(angle));
  });
}
export function strip(a: XY, b: XY, half: number): XY[] {
  const n = b.clone().sub(a).normalize().rotateAround(point(0, 0), Math.PI / 2).multiplyScalar(half);
  return [a.clone().sub(n), b.clone().sub(n), b.clone().add(n), a.clone().add(n)];
}

export interface Span { id: string; start: number; count: number }
export interface PackedMesh {
  positions: Float32Array; colors: Float32Array; patterns: Uint8Array; ink: Float32Array; spans: Span[];
}
const pigments = new Map<string, Color>();
// Accumulate large town meshes as floats from the start. Growing JS number
// arrays and then copying them at worker handoff doubles peak memory on phones.
class Triples {
  private blocks: Float32Array[]=[];
  length=0;
  push(x:number,y:number,z:number) {
    const offset=this.length%12288;
    if(!offset) this.blocks.push(new Float32Array(12288));
    const block=this.blocks[this.blocks.length-1];
    block[offset]=x; block[offset+1]=y; block[offset+2]=z; this.length+=3;
  }
  pack() {
    const out=new Float32Array(this.length);
    for(let i=0;i<this.blocks.length;i++) {
      const start=i*12288;
      out.set(this.blocks[i].subarray(0,this.length-start),start);
    }
    return out;
  }
}
export class MeshBatch {
  private positions=new Triples();
  private colors=new Triples();
  private patterns: number[] = [];
  private ink=new Triples();
  private spans: Span[] = [];

  entity(id: string, build: () => void) {
    const start = this.positions.length / 3;
    build();
    this.spans.push({ id, start, count: this.positions.length / 3 - start });
  }
  triangle(a: XYZ, b: XYZ, c: XYZ, paint: string, pattern = 0) {
    let color = pigments.get(paint);
    if (!color) { color = new Color(paint); pigments.set(paint, color); }
    this.positions.push(...a); this.positions.push(...b); this.positions.push(...c);
    this.patterns.push(pattern,pattern,pattern);
    for (let i = 0; i < 3; i++) this.colors.push(color.r, color.g, color.b);
  }
  quad(a: XYZ, b: XYZ, c: XYZ, d: XYZ, paint: string, pattern = 0) {
    this.triangle(a, b, c, paint, pattern);
    this.triangle(a, c, d, paint, pattern);
  }
  line(a: XYZ, b: XYZ) { this.ink.push(...a); this.ink.push(...b); }
  surface(poly: Polygon, h: number, paint: string, pattern = 0) {
    const rings = poly.map(ring => {
      const pts = ring.map(([x, y]) => point(x, y));
      if (pts.length > 1 && pts[0].equals(pts[pts.length - 1])) pts.pop();
      return pts;
    });
    if (rings[0].length < 3) return;
    const faces = ShapeUtils.triangulateShape(rings[0], rings.slice(1));
    const points = rings.flat();
    for (const [a, b, c] of faces) this.triangle(world(points[a], h), world(points[b], h), world(points[c], h), paint, pattern);
  }
  prism(points: XY[], low: number, high: number, paint: string, outline = false, pattern = 0) {
    this.surface([points.map(pair)], high, paint, pattern);
    this.surface([points.map(pair)], low, paint, pattern);
    points.forEach((a, i) => {
      const b = points[(i + 1) % points.length];
      this.quad(world(a, low), world(b, low), world(b, high), world(a, high), paint, pattern);
      if (outline) this.line(world(a, high), world(b, high));
    });
  }
  pack(): PackedMesh {
    return { positions: this.positions.pack(), colors: this.colors.pack(),
      patterns:new Uint8Array(this.patterns), ink: this.ink.pack(), spans: this.spans };
  }
}
