// Port of Graph/Topology, GPL-3.0. P4 uses deterministic shortest paths.
import { add } from './context.js';
import { GraphNode as Node, shortestPath } from './pathfinding.js';
import { Point, Polygon } from './geometry.js';
import type { Model } from './model.js';
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
    const path = shortestPath(start, goal, exclude);
    return path ? new Polygon(path.map(n => this.node2pt.get(n)!)) : null;
  }
}
