// Port of Graph/Topology, GPL-3.0. FIFO path selection is intentionally retained for P2.
import { add, remove } from './context.js';
import { Point, Polygon } from './geometry.js';
import type { Model } from './model.js';
class Node {
  readonly links = new Map<Node, number>();
  constructor(readonly id: number) {}
  link(node: Node, cost: number): void { this.links.set(node, cost); node.links.set(this, cost); }
}
export class Topology {
  readonly pt2node = new Map<Point, Node>();
  readonly node2pt = new Map<Node, Point>();
  readonly inner: Node[] = []; readonly outer: Node[] = [];
  constructor(model: Model) {
    const blocked = [...(model.citadel?.shape ?? []), ...(model.wall?.shape ?? [])].filter(v => !model.gates.includes(v));
    const process = (v: Point): Node | null => {
      let node = this.pt2node.get(v);
      if (!node) { node = new Node(this.pt2node.size); this.pt2node.set(v, node); this.node2pt.set(node, v); }
      return blocked.includes(v) ? null : node;
    };
    for (const patch of model.patches) {
      let v1 = patch.shape[patch.shape.length - 1], n1 = process(v1);
      for (const v of patch.shape) {
        const v0 = v1, n0 = n1; v1 = v; n1 = process(v1);
        const group = patch.withinCity ? this.inner : this.outer;
        if (n0 && !model.border!.shape.includes(v0)) add(group, n0);
        if (n1 && !model.border!.shape.includes(v1)) add(group, n1);
        if (n0 && n1) n0.link(n1, Point.distance(v0, v1));
      }
    }
  }
  buildPath(from: Point, to: Point, exclude: Node[]): Polygon | null {
    const start = this.pt2node.get(from), goal = this.pt2node.get(to); if (!start || !goal) return null;
    const open = [start], closed = [...exclude], came = new Map<Node, Node>(), scores = new Map([[start, 0]]);
    while (open.length) {
      const current = open.shift()!;
      if (current === goal) { const result = [current]; let c = current; while (came.has(c)) { c = came.get(c)!; result.push(c); } return new Polygon(result.map(n => this.node2pt.get(n)!)); }
      remove(open, current); closed.push(current);
      // Haxe ObjectMap enumerates numeric object IDs, not insertion order.
      for (const next of [...current.links.keys()].sort((a, b) => a.id - b.id)) {
        if (closed.includes(next)) continue;
        const score = scores.get(current)! + current.links.get(next)!;
        if (!open.includes(next)) open.push(next); else if (score >= scores.get(next)!) continue;
        came.set(next, current); scores.set(next, score);
      }
    }
    return null;
  }
}
