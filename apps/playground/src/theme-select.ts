import { THEMES, THEME_LABELS } from '@settlement/map-scene';

/** One catalog for the main map and renderer comparison. */
export function populateThemes(select: HTMLSelectElement): void {
  const selected = select.value;
  select.replaceChildren(...Object.entries(THEME_LABELS).map(([key, label]) => new Option(label, key)));
  select.value = Object.hasOwn(THEMES, selected) ? selected : 'parchment';
}
