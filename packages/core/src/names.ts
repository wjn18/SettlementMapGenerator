import type { TownData, TownAtlas, NamedRegion, District, Point2 } from './types.js';

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
const choose = <T>(items: readonly T[], key: string): T => items[hash(key) % items.length];
export function normalizeMapName(value: string): string {
  if (typeof value !== 'string') throw new Error('名称必须是文本');
  const name = value.normalize('NFC').trim().replace(/ +/g, ' ');
  if (!name || Array.from(name).length > 64 || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(name)) throw new Error('名称须为 1–64 个可见字符');
  return name;
}

/** Region adjacency uses a shared land edge, never a road/bridge connection.
 * Naming has its own hash stream and does not consume geometry randomness. */
export function regionAdjacency(town: TownData): Map<string, Set<string>> {
  const city = town.districts.filter(d => d.withinCity), result = new Map(city.map(d => [d.id, new Set<string>()]));
  const edges = new Map<string, string[]>();
  for (const d of city) for (let i = 0; i < d.boundary.length; i++) {
    const key = [d.boundary[i], d.boundary[(i + 1) % d.boundary.length]].sort().join('/');
    const others = edges.get(key) ?? [];
    for (const other of others) { result.get(d.id)!.add(other); result.get(other)!.add(d.id); }
    others.push(d.id); edges.set(key, others);
  }
  return result;
}

export function createTownAtlas(town: TownData): TownAtlas {
  const city = town.districts.filter(d => d.withinCity), districts = new Map(city.map(d => [d.id, d]));
  const vertices = new Map(town.vertices.map(v => [v.id, v]));
  const centers = new Map(city.map(d => [d.id, d.boundary.reduce((p, id) => { const v = vertices.get(id)!; return { x: p.x + v.x / d.boundary.length, y: p.y + v.y / d.boundary.length }; }, { x: 0, y: 0 })]));
  const graph = regionAdjacency(town), remaining = new Set(city.map(d => d.id));
  const groups: { kind: NamedRegion['kind']; members: string[] }[] = [];
  const kind = (d: District): NamedRegion['kind'] => d.wardType === 'Castle' ? 'citadel' : d.wardType === 'Harbor' ? 'harbor' : 'quarter';
  for (const district of city) {
    if (!remaining.has(district.id)) continue;
    const groupKind = kind(district), component: string[] = [], queue = [district.id];
    while (queue.length) {
      const id = queue.shift()!; if (!remaining.has(id) || kind(districts.get(id)!) !== groupKind) continue;
      remaining.delete(id); component.push(id);
      if (groupKind !== 'citadel') queue.push(...graph.get(id)!);
    }
    const count = groupKind === 'quarter' ? Math.max(1, Math.ceil(component.length / 5)) : 1;
    const members = new Set(component);
    const seeds = [component.find(id => districts.get(id)!.wardType === 'Market') ?? component[0]];
    const distances = (root: string): Map<string, number> => {
      const dist = new Map([[root, 0]]), pending = [root];
      while (pending.length) { const id = pending.shift()!; for (const other of graph.get(id)!) if (members.has(other) && !dist.has(other)) { dist.set(other, dist.get(id)! + 1); pending.push(other); } }
      return dist;
    };
    const seedDistances = [distances(seeds[0])];
    while (seeds.length < count) {
      let best = component[0], score = -1;
      for (const id of component) {
        const distance = Math.min(...seedDistances.map(d => d.get(id) ?? Infinity));
        if (distance > score) { best = id; score = distance; }
      }
      if (seeds.includes(best)) break;
      seeds.push(best); seedDistances.push(distances(best));
    }
    const owner = new Map<string, number>(), pending: string[] = [];
    seeds.forEach((id, i) => { owner.set(id, i); pending.push(id); });
    while (pending.length) {
      const id = pending.shift()!;
      const neighbors = [...graph.get(id)!].sort((a, b) => Number(districts.get(b)!.wardType === districts.get(id)!.wardType) - Number(districts.get(a)!.wardType === districts.get(id)!.wardType));
      for (const other of neighbors) if (members.has(other) && !owner.has(other)) { owner.set(other, owner.get(id)!); pending.push(other); }
    }
    const partitions = seeds.map((_, i) => component.filter(id => owner.get(id) === i));
    for (let i = 0; i < partitions.length; i++) if (partitions[i].length === 1 && partitions.length > 1) {
      const id = partitions[i][0], neighbor = [...graph.get(id)!].find(n => members.has(n) && owner.get(n) !== i);
      if (neighbor) { const target = owner.get(neighbor)!; partitions[target].push(id); owner.set(id, target); partitions[i] = []; }
    }
    for (const ids of partitions) if (ids.length) groups.push({ kind: groupKind, members: ids.sort((a, b) => city.findIndex(d => d.id === a) - city.findIndex(d => d.id === b)) });
  }
  const seed = String(town.resolved.seed), used = new Set<string>();
  const prefixes = ['Mist', 'Ash', 'Raven', 'Thorn', 'Grey', 'Oak', 'Silver', 'Briar', 'Willow', 'Alder', 'Stone', 'Cedar'];
  const suffixes = ['wind', 'haven', 'ford', 'mere', 'wick', 'crest', 'fall', 'bridge', 'brook', 'worth'];
  const regions = groups.map((group, i): NamedRegion => {
    const center: Point2 = group.members.reduce((p, id) => ({ x: p.x + centers.get(id)!.x / group.members.length, y: p.y + centers.get(id)!.y / group.members.length }), { x: 0, y: 0 });
    const direction = Math.abs(center.x - town.center.x) > Math.abs(center.y - town.center.y) ? (center.x > town.center.x ? 'East' : 'West') : (center.y > town.center.y ? 'South' : 'North');
    let name = group.kind === 'citadel' ? 'Citadel' : group.kind === 'harbor' ? `${direction} Docks` : choose(['Old Quarter', 'Ashcrest', 'Mill Ward', 'Highmarket', 'Oak Hill', 'Stonebridge', 'Copperside', 'Rosebank', 'Westfield', 'Candle Row', 'Alder Gate', 'Silver Ward'], `${seed}/region/${i}`);
    if (group.kind === 'quarter' && group.members.some(id => districts.get(id)!.wardType === 'Market')) name = 'Market Quarter';
    const base = name; let suffix = 2;
    while (used.has(name)) name = `${base} ${suffix++}`;
    used.add(name);
    return { id: `region${i}`, name, kind: group.kind, districtIds: group.members };
  });
  return { version: '1', cityName: choose(prefixes, `${seed}/city/prefix`) + choose(suffixes, `${seed}/city/suffix`), regions };
}

/** Return detached metadata, including for old geometry-only JSON. */
export function getTownAtlas(town: TownData): TownAtlas {
  const atlas = town.atlas ?? createTownAtlas(town);
  return { ...atlas, regions: atlas.regions.map(r => ({ ...r, districtIds: [...r.districtIds] })) };
}

export function renameTown(town: TownData, target: 'city' | string, value: string): TownData {
  const name = normalizeMapName(value), atlas = getTownAtlas(town);
  if (target === 'city') atlas.cityName = name;
  else { const region = atlas.regions.find(r => r.id === target); if (!region) throw new Error('找不到该区域'); region.name = name; }
  return { ...town, atlas };
}
