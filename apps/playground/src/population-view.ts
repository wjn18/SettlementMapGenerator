import type { DistrictPopulation, PopulationEstimate, PopulationStats } from '@settlement/core';
import './population.css';

const number = (value: number) => value.toLocaleString('en-US');
const hectares = (value: number) => (value / 10_000).toLocaleString('en-US', { maximumFractionDigits: 2 });
export const populationText = (stats: PopulationStats | DistrictPopulation): string => stats.residents === null
  ? '人口未估算（城郊不适用城市密度）'
  : `人口估算 ≈ ${number(stats.residents)} 人（低–高情景 ${number(stats.lower!)}–${number(stats.upper!)}）`;
export function renderPopulation(estimate: PopulationEstimate): void {
  const total = document.getElementById('population-total')!;
  total.textContent = `≈ ${number(estimate.total.residents)}`; total.dataset.residents = String(estimate.total.residents);
  document.getElementById('population-range')!.textContent = `低–高情景 ${number(estimate.total.lower)}–${number(estimate.total.upper)} 人`;
  document.getElementById('population-split')!.textContent = `城区用地约 ${hectares(estimate.city.urbanAreaM2)} 公顷 · 城郊未估算`;
  document.getElementById('population-building-check')!.textContent = estimate.city.buildingCount > 0
    ? `${number(estimate.city.buildingCount)} 栋城区建筑 · 平均约 ${(estimate.city.residents / estimate.city.buildingCount).toFixed(1)} 人/栋`
    : '缺少城区建筑，区域人数暂无法分配';
  document.getElementById('population-area')!.textContent = `${number(estimate.city.buildingCount)} 栋城区建筑 · 建筑占地约 ${number(Math.round(estimate.city.footprintAreaM2))} m²（仅用于分配区域人数）`;
  const rows = estimate.regions.map(region => {
    const tr = document.createElement('tr'); tr.dataset.region = region.regionId;
    const name = document.createElement('th'); name.scope = 'row'; name.textContent = region.name;
    const count = document.createElement('td'); count.textContent = `≈ ${number(region.residents)}`; count.dataset.residents = String(region.residents);
    tr.append(name, count); return tr;
  });
  if (estimate.unallocated.upper > 0) {
    const tr = document.createElement('tr'); tr.id = 'population-unallocated';
    const label = document.createElement('th'), value = document.createElement('td');
    label.scope = 'row'; label.textContent = '未分配到区域（缺少建筑）'; value.textContent = `≈ ${number(estimate.unallocated.residents)}`;
    tr.append(label, value); rows.push(tr);
  }
  const outskirts = document.createElement('tr'), label = document.createElement('th'), value = document.createElement('td');
  label.scope = 'row'; label.textContent = '城郊'; value.textContent = '未估算';
  outskirts.append(label, value); rows.push(outskirts);
  document.getElementById('population-regions')!.replaceChildren(...rows);
  document.getElementById('population-formula')!.textContent = `城区用地 ${hectares(estimate.city.urbanAreaM2)} 公顷 × ${estimate.assumptions.personsPerHectare} 人/公顷 ≈ ${number(estimate.city.residents)} 人。`;
  document.getElementById('population-assumptions')!.textContent = `距离采用 1 地图单位 = ${estimate.assumptions.metersPerUnit} 米，1 公顷 = 10,000 m²。${estimate.assumptions.areaBasis}`;
  document.getElementById('population-allocation')!.textContent = estimate.assumptions.allocationBasis;
  document.getElementById('population-limitations')!.replaceChildren(...estimate.assumptions.limitations.map(text => {
    const item = document.createElement('li'); item.textContent = text; return item;
  }));
  document.getElementById('population-sources')!.replaceChildren(...estimate.sources.map(source => {
    const p = document.createElement('p'), link = document.createElement('a');
    link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = `${source.author} (${source.year}), ${source.title}, p. ${source.page}`;
    p.append(link, document.createElement('br'), source.note); return p;
  }));
  (document.getElementById('population-report') as HTMLButtonElement).disabled = false;
}
