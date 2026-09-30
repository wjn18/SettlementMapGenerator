// Archived P2 algorithm for migration parity tests ONLY. Not shipped in packages.
import { Topology } from '../../packages/core/dist/topology.js';
import { Polygon } from '../../packages/core/dist/geometry.js';
export function installLegacyPaths() {
  const original = Topology.prototype.buildPath;
  Topology.prototype.buildPath = function(from, to, exclude) {
    const start = this.pt2node.get(from), goal = this.pt2node.get(to); if (!start || !goal) return null;
    const open = [start], closed = [...exclude], came = new Map(), scores = new Map([[start, 0]]);
    while (open.length) {
      const current = open.shift();
      if (current === goal) {
        const result = [current]; let c = current;
        while (came.has(c)) { c = came.get(c); result.push(c); }
        return new Polygon(result.map(n => this.node2pt.get(n)));
      }
      closed.push(current);
      for (const next of [...current.links.keys()].sort((a,b) => a.id - b.id)) {
        if (closed.includes(next)) continue;
        const score = scores.get(current) + current.links.get(next);
        if (!open.includes(next)) open.push(next); else if (score >= scores.get(next)) continue;
        came.set(next, current); scores.set(next, score);
      }
    }
    return null;
  };
  return () => { Topology.prototype.buildPath = original; };
}
