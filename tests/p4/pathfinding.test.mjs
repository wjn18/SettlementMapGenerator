import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphNode, shortestPath } from '../../packages/core/dist/pathfinding.js';

test('weighted paths settle by cost, including improving an already discovered route', () => {
  const [a,b,c,d] = Array.from({length:4},(_,i)=>new GraphNode(i));
  a.link(b,10); a.link(c,1); c.link(b,1); b.link(d,1); c.link(d,20);
  assert.deepEqual(shortestPath(a,d),[d,b,c,a]);
  assert.deepEqual(shortestPath(a,d,[b]),[d,c,a]);
});
test('ties, zero-cost cycles, excluded endpoints and disconnected graphs terminate deterministically', () => {
  const [a,b,c,d,e] = Array.from({length:5},(_,i)=>new GraphNode(i));
  a.link(c,1); a.link(b,1); b.link(d,1); c.link(d,1); b.link(c,0);
  assert.deepEqual(shortestPath(a,d),[d,b,a]);
  assert.deepEqual(shortestPath(a,a),[a]);
  for(const exclusions of [[a],[d],[b,c]]) assert.equal(shortestPath(a,d,exclusions),null);
  assert.equal(shortestPath(a,e),null);
  for(const cost of [-1,NaN,Infinity]) assert.throws(()=>a.link(e,cost),RangeError);
});
test('all pairs on 30 reproducible weighted graphs match independent Floyd–Warshall distances', () => {
  let state=42; const random=()=> (state=(state*48271)%2147483647)/2147483647;
  for(let sample=0;sample<30;sample++) {
    const n=12,nodes=Array.from({length:n},(_,i)=>new GraphNode(i));
    const dist=nodes.map((_,i)=>nodes.map((_,j)=>i===j?0:Infinity));
    for(let i=0;i<n;i++) for(let j=i+1;j<n;j++) if(random()<0.22) {
      const cost=Math.floor(random()*20); nodes[i].link(nodes[j],cost); dist[i][j]=dist[j][i]=cost;
    }
    for(let k=0;k<n;k++) for(let i=0;i<n;i++) for(let j=0;j<n;j++) dist[i][j]=Math.min(dist[i][j],dist[i][k]+dist[k][j]);
    for(let i=0;i<n;i++) for(let j=0;j<n;j++) {
      const path=shortestPath(nodes[i],nodes[j]);
      if(!Number.isFinite(dist[i][j])) { assert.equal(path,null); continue; }
      assert.equal(new Set(path).size,path.length);
      assert.equal(path.reduce((sum,node,k)=>sum+(k?node.links.get(path[k-1]):0),0),dist[i][j]);
    }
  }
});
