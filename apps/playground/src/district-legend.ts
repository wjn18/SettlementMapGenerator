import { DISTRICT_STYLES, districtColor } from '@settlement/map-scene';
import type { MapTheme } from '@settlement/map-scene';
import type { TownData } from '@settlement/core';
import './district-legend.css';

export const districtLabels: Record<string, string> = Object.fromEntries(Object.entries(DISTRICT_STYLES).map(([type, style]) => [type, style.label]));
export function renderDistrictLegend(host: HTMLElement, town: TownData, palette: MapTheme, enabled: boolean): void {
  const present = new Set(town.districts.filter(d => d.withinCity || d.wardType === 'Farm' || d.wardType === 'Park').map(d => d.wardType));
  const known = Object.keys(DISTRICT_STYLES), types = [...known.filter(type => present.has(type)), ...[...present].filter(type => !Object.hasOwn(DISTRICT_STYLES, type))];
  host.replaceChildren(...types.map(type => {
    const item = document.createElement('span'); item.className = 'district-key'; item.dataset.ward = type;
    const swatch = document.createElement('i'); swatch.style.backgroundColor = districtColor(palette, type); swatch.setAttribute('aria-hidden', 'true');
    item.append(swatch, document.createTextNode(districtLabels[type] ?? type)); return item;
  }));
  host.classList.toggle('inactive', !enabled);
  host.setAttribute('aria-hidden', String(!enabled));
}
