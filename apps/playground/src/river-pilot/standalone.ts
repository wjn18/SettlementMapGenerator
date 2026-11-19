import { mountRiverStudio } from './studio';

const dispose = mountRiverStudio(document.getElementById('river-app')!, {onBack: selected => {
  location.href = './?sample=' + (selected==='sample'?'arch-river':encodeURIComponent(selected));
}});
window.addEventListener('pagehide', e => { if (!e.persisted) dispose(); });
