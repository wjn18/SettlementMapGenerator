/** Internal undirected graph. Costs must be finite and nonnegative. */
export class GraphNode {
  readonly links = new Map<GraphNode, number>();
  constructor(readonly id: number) {}
  link(node: GraphNode, cost: number): void {
    if (!Number.isFinite(cost) || cost < 0) throw new RangeError('Invalid graph edge cost');
    this.links.set(node, cost); node.links.set(this, cost);
  }
}

/** Dijkstra; equal distances use stable node IDs. Returns goal → start, as
 * required by the legacy road assembly. No heuristic or ambient state. */
export function shortestPath(start: GraphNode, goal: GraphNode, exclude: readonly GraphNode[] = []): GraphNode[] | null {
  const closed = new Set(exclude);
  if (closed.has(start) || closed.has(goal)) return null;
  const open = new Set([start]), scores = new Map([[start, 0]]), came = new Map<GraphNode, GraphNode>();
  while (open.size) {
    let current = start, best = Infinity;
    for (const node of open) {
      const score = scores.get(node)!;
      if (score < best || (score === best && node.id < current.id)) { current = node; best = score; }
    }
    if (current === goal) {
      const result = [current];
      while (came.has(current)) { current = came.get(current)!; result.push(current); }
      return result;
    }
    open.delete(current); closed.add(current);
    for (const [next, cost] of [...current.links].sort(([a], [b]) => a.id - b.id)) {
      if (!Number.isFinite(cost) || cost < 0) throw new RangeError('Invalid graph edge cost');
      if (closed.has(next)) continue;
      const score = best + cost;
      if (!Number.isFinite(score)) throw new RangeError('Graph path cost overflow');
      if (score >= (scores.get(next) ?? Infinity)) continue;
      came.set(next, current); scores.set(next, score); open.add(next);
    }
  }
  return null;
}
