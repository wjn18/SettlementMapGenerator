import { validateTown } from './serialization.js';
import { getTownAtlas } from './names.js';
import type { TownData, Point2, Id } from './types.js';

export type PopulationDensity = 'sparse' | 'typical' | 'dense';
export interface PopulationOptions { density?: PopulationDensity; metersPerUnit?: number }
export interface PopulationCounts { residents: number; lower: number; upper: number }
export interface PopulationStats extends PopulationCounts {
  buildingCount: number; footprintAreaM2: number; urbanAreaM2: number;
}
export interface DistrictPopulation {
  districtId: Id; wardType: string; withinCity: boolean;
  residents: number | null; lower: number | null; upper: number | null;
  buildingCount: number; footprintAreaM2: number; urbanAreaM2: number;
  allocationWeightM2: number;
}
export interface RegionPopulation extends PopulationStats { regionId: Id; name: string; districtIds: Id[] }
export interface PopulationSource { author: string; year: number; title: string; url: string; page: number; note: string }
export interface PopulationEstimate {
  modelVersion: '2';
  assumptions: {
    method: 'urban-area'; scope: 'city-only'; density: PopulationDensity; personsPerHectare: number;
    scenarioDensities: Record<PopulationDensity, number>; metersPerUnit: number;
    areaBasis: string; allocationBasis: string; limitations: string[];
  };
  sources: PopulationSource[];
  /** total covers the estimated city only; rural residents are unknown. */
  total: PopulationStats; city: PopulationStats;
  outskirts: { residents: null; lower: null; upper: null; buildingCount: number; footprintAreaM2: number; reason: string };
  /** City residents without eligible building footprints cannot be placed in a district. */
  unallocated: PopulationCounts;
  districts: DistrictPopulation[]; regions: RegionPopulation[];
}

/** Buringh (2021), p. 8: an urban land-area proxy, not a floor-area coefficient. */
export const POPULATION_DENSITIES: Readonly<Record<PopulationDensity, number>> = Object.freeze({ sparse: 50, typical: 100, dense: 200 });
export const POPULATION_SOURCE: Readonly<PopulationSource> = Object.freeze({
  author: 'Eltjo Buringh', year: 2021, title: 'The Population of European Cities from 700 to 2000',
  url: 'https://researchdatajournal.org/article/download/24674/25863/63436', page: 8,
  note: '文献以 57 座欧洲中世纪城市校准，采用每公顷 100 人的面积代理值，并讨论约 50–200 人/公顷的差异；这些值不是单座城市的置信区间。',
});
const counts = (): PopulationCounts => ({ residents: 0, lower: 0, upper: 0 });
const emptyStats = (): PopulationStats => ({ ...counts(), buildingCount: 0, footprintAreaM2: 0, urbanAreaM2: 0 });
const countKeys = ['residents', 'lower', 'upper'] as const;
const statsKeys = [...countKeys, 'buildingCount', 'footprintAreaM2', 'urbanAreaM2'] as const;
function checkNumber(value: number, integer = false): void {
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) throw new RangeError('Population estimate exceeds numeric limits');
}
function area(boundary: Id[], vertices: Map<Id, Point2>): number {
  const origin = vertices.get(boundary[0])!; let twiceArea = 0;
  for (let i = 1; i < boundary.length - 1; i++) {
    const a = vertices.get(boundary[i])!, b = vertices.get(boundary[i + 1])!;
    twiceArea += (a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y);
  }
  return Math.abs(twiceArea) / 2;
}

/** Largest-remainder allocation, with stable ID ties and exact integer totals. */
function allocate(total: number, districts: DistrictPopulation[], weight: number): number[] {
  const shares = districts.map(d => total * (d.allocationWeightM2 / weight));
  const result = shares.map(Math.floor);
  const order = shares.map((share, i) => ({ i, remainder: share - result[i], id: districts[i].districtId }))
    .sort((a, b) => b.remainder - a.remainder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const remaining = total - result.reduce((sum, n) => sum + n, 0);
  if (remaining < 0 || remaining > order.length) throw new RangeError('Population allocation exceeds numeric precision');
  for (let i = 0; i < remaining; i++) result[order[i].i]++;
  return result;
}

/** Estimate city residents using inhabited urban land area as a proxy. Generated
 * district rings are land clipped by terrain and include internal streets/yards.
 * Bounds are fixed 50/200 people per hectare scenarios, not confidence intervals. */
export function estimatePopulation(town: TownData, options: PopulationOptions = {}): PopulationEstimate {
  validateTown(town);
  if (Object.keys(options).some(key => key !== 'density' && key !== 'metersPerUnit')) throw new RangeError('Unknown population option');
  const density = options.density ?? 'typical', metersPerUnit = options.metersPerUnit ?? 1;
  if (typeof density !== 'string' || !Object.hasOwn(POPULATION_DENSITIES, density)) throw new RangeError('Invalid population density');
  if (!Number.isFinite(metersPerUnit) || metersPerUnit <= 0) throw new RangeError('Invalid population distance scale');
  const areaScale = metersPerUnit ** 2; checkNumber(areaScale);
  if (areaScale === 0) throw new RangeError('Population distance scale is too small');
  const vertices = new Map(town.vertices.map(v => [v.id, v]));
  const districts: DistrictPopulation[] = town.districts.map(d => ({
    ...emptyStats(), districtId: d.id, wardType: d.wardType, withinCity: d.withinCity,
    residents: d.withinCity ? 0 : null, lower: d.withinCity ? 0 : null, upper: d.withinCity ? 0 : null,
    urbanAreaM2: d.withinCity ? area(d.boundary, vertices) * areaScale : 0, allocationWeightM2: 0,
  }));
  const byId = new Map(districts.map(d => [d.districtId, d]));
  // Building footprints only distribute the city estimate; they do not determine its total.
  for (const building of town.buildings) {
    const district = byId.get(building.districtId)!;
    district.buildingCount++;
    district.footprintAreaM2 += area(building.boundary, vertices) * areaScale;
  }
  const city = emptyStats();
  const outskirts: PopulationEstimate['outskirts'] = { residents: null, lower: null, upper: null, buildingCount: 0, footprintAreaM2: 0, reason: '城郊农地不适用城市用地密度，本模型未估算城郊人口。' };
  for (const d of districts) {
    checkNumber(d.footprintAreaM2); checkNumber(d.urbanAreaM2);
    const target = d.withinCity ? city : outskirts;
    target.buildingCount += d.buildingCount; target.footprintAreaM2 += d.footprintAreaM2;
    if (d.withinCity) {
      city.urbanAreaM2 += d.urbanAreaM2;
      if (d.wardType !== 'Market' && d.wardType !== 'Park') d.allocationWeightM2 = d.footprintAreaM2;
    }
  }
  const scenarioCounts = Object.fromEntries(Object.entries(POPULATION_DENSITIES).map(([key, value]) => [key, Math.round(city.urbanAreaM2 / 10_000 * value)])) as Record<PopulationDensity, number>;
  city.residents = scenarioCounts[density]; city.lower = scenarioCounts.sparse; city.upper = scenarioCounts.dense;
  for (const key of statsKeys) checkNumber(city[key], countKeys.includes(key as typeof countKeys[number]));
  checkNumber(outskirts.footprintAreaM2);
  const eligible = districts.filter(d => d.allocationWeightM2 > 0);
  const weight = eligible.reduce((sum, d) => sum + d.allocationWeightM2, 0); checkNumber(weight);
  let unallocated = counts();
  if (weight > 0) {
    // Allocate successive increments so every district's scenarios stay ordered.
    const low = allocate(scenarioCounts.sparse, eligible, weight);
    const mid = allocate(scenarioCounts.typical - scenarioCounts.sparse, eligible, weight);
    const high = allocate(scenarioCounts.dense - scenarioCounts.typical, eligible, weight);
    eligible.forEach((d, i) => {
      d.lower = low[i]; d.upper = low[i] + mid[i] + high[i];
      d.residents = density === 'sparse' ? d.lower : density === 'dense' ? d.upper : low[i] + mid[i];
    });
  } else unallocated = { residents: city.residents, lower: city.lower, upper: city.upper };
  const regions = getTownAtlas(town).regions.map(region => {
    const result: RegionPopulation = { ...emptyStats(), regionId: region.id, name: region.name, districtIds: [...region.districtIds] };
    for (const id of region.districtIds) for (const key of statsKeys) result[key] += byId.get(id)![key]!;
    return result;
  });
  return {
    modelVersion: '2',
    assumptions: {
      method: 'urban-area', scope: 'city-only', density, personsPerHectare: POPULATION_DENSITIES[density],
      scenarioDensities: { ...POPULATION_DENSITIES }, metersPerUnit,
      areaBasis: '以城区地块面积合计近似已居住城市用地，包含其中的道路、院落、市场和公园；不以城墙或整张地图边界计面积。生成地图的河海水域已从地块裁去，城郊地块不计。',
      allocationBasis: '区域人数按城区建筑占地比例分配，市场、公园及装饰不参与分配；这是模型分配假设，不是文献给出的街区密度。没有可分配建筑时保留城区总估值，并列为未分配人口。',
      limitations: ['50–200 人/公顷是低、高情景，不是统计置信区间或实际人口界限。', '地图尺度和城区范围未经历史校准，城区地块面积只是已居住用地的近似；小村落也沿用这一城市代理值。', '不再假定楼层、入住率或贫富街区人均面积；图形建筑数量不等同于实际住宅户数。', ...(town.river && !town.river.surface ? ['此地图使用旧版未裁切河道的地块，城区面积可能包含河道，人口估算可能偏高。'] : [])],
    },
    sources: [{ ...POPULATION_SOURCE }], total: { ...city }, city, outskirts, unallocated, districts, regions,
  };
}
