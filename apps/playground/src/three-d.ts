import type { TownData } from '@settlement/core';
import { createBlenderView } from './blender-view';
import './three-d.css';

type View = 'plan' | 'live' | 'blender';

export function createThreeD(getTown: () => TownData | null) {
  const byId = (id: string) => document.getElementById(id)!;
  const livePanel = byId('live-town'), liveControls = byId('live-controls');
  const blenderPanel = byId('three-d-panel'), blenderControls = byId('blender-controls');
  const planTab = byId('view-plan'), sceneTab = byId('view-three-d');
  const mode = byId('three-d-mode') as HTMLSelectElement;
  const query = new URLSearchParams(location.search);
  const legacyLink = query.get('view') === 'blender' || query.has('job');
  byId('three-d-mode-label').hidden = !import.meta.env.DEV && !legacyLink;
  let view: View = 'plan';
  let blender: ReturnType<typeof createBlenderView> | undefined;
  let liveTown: TownData | null = null, disposeStudio: (() => void) | undefined;
  let revision = 0;

  function clearStudio() {
    revision++;
    disposeStudio?.();
    disposeStudio = undefined;
    liveTown = null;
    livePanel.replaceChildren();
    liveControls.replaceChildren();
  }

  function notice(message: string) {
    const status = document.createElement('p');
    status.className = 'live-status'; status.setAttribute('role', 'status');
    status.textContent = message; livePanel.replaceChildren(status);
  }

  async function mountCurrent(town: TownData) {
    const token = ++revision;
    liveTown = town;
    notice('正在打开三维视图…');
    try {
      const { mountRiverStudio } = await import('./river-pilot/studio');
      if (token !== revision || view !== 'live') return;
      disposeStudio = mountRiverStudio(livePanel, { town, sidebar: liveControls });
    } catch {
      if (token !== revision) return;
      clearStudio();
      notice('三维视图加载失败。');
      const retry = document.createElement('button');
      retry.type = 'button'; retry.textContent = '重试';
      retry.onclick = () => update(); livePanel.append(retry);
    }
  }

  function update() {
    const town = getTown();
    if (liveTown && town !== liveTown) clearStudio();
    if (view === 'live') {
      if (!town) notice('等待当前城镇规划…');
      else if (liveTown !== town) void mountCurrent(town);
    } else if (view === 'blender') {
      void blender?.update();
    }
  }

  function show(next: View, writeURL = true) {
    if (view === next) {
      document.dispatchEvent(new CustomEvent('map-view-change', { detail: { threeD: next !== 'plan' } }));
      return;
    }
    // Keep the camera when revisiting the same town. Invalidate pending imports
    // on exit so a late module cannot put controls into a different view.
    if (view === 'live' && !disposeStudio) clearStudio();
    if (view === 'blender') blender?.setActive(false);
    view = next;
    const threeD = next !== 'plan';
    livePanel.hidden = liveControls.hidden = next !== 'live';
    blenderPanel.hidden = blenderControls.hidden = next !== 'blender';
    planTab.setAttribute('aria-pressed', String(!threeD));
    sceneTab.setAttribute('aria-pressed', String(threeD));
    sceneTab.setAttribute('aria-controls', next === 'blender' ? blenderPanel.id : livePanel.id);
    byId('map').style.visibility = threeD ? 'hidden' : '';
    document.querySelectorAll<HTMLElement>('.map-actions, .cartography-tools, .district-legend, .bottom-bar')
      .forEach(section => { section.hidden = threeD; });
    if (threeD) {
      mode.value = next;
      byId('names-panel').hidden = byId('tooltip').hidden = true;
      byId('edit-names').setAttribute('aria-expanded','false');
    }
    if (next === 'blender') {
      blender ??= createBlenderView(getTown, blenderControls, blenderPanel);
      blender.setActive(true);
    }
    if (writeURL) {
      const url = new URL(location.href);
      if (next === 'plan') url.searchParams.delete('view');
      else url.searchParams.set('view', next === 'live' ? '3d' : 'blender');
      if (next !== 'blender') url.searchParams.delete('job');
      window.history.replaceState(null, '', url);
    }
    update();
    document.dispatchEvent(new CustomEvent('map-view-change', { detail: { threeD } }));
  }

  planTab.onclick = () => show('plan');
  const showScene = () => show(view === 'blender' ? 'blender' : 'live');
  sceneTab.onclick = showScene;
  mode.onchange = () => show(mode.value === 'blender' ? 'blender' : 'live');
  document.addEventListener('sidebar-task-change', event => {
    const task = (event as CustomEvent<{task: string}>).detail.task;
    if (task === 'three-d') showScene();
    else if (task === 'generate' || task === 'population') show('plan');
  });
  window.addEventListener('pagehide', event => {
    if (!event.persisted) { clearStudio(); blender?.setActive(false); }
  });
  if (legacyLink) show('blender', false);
  else if (query.get('view') === '3d') show('live', false);
  return { update };
}
