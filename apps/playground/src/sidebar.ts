type SidebarTask = 'generate' | 'three-d' | 'population' | 'files';
const tasks: SidebarTask[] = ['generate', 'three-d', 'population', 'files'];

export function setupSidebar() {
  const sidebar = document.querySelector<HTMLElement>('.sidebar')!;
  const content = document.getElementById('sidebar-content')!;
  const collapse = document.getElementById('sidebar-collapse')!;
  const form = document.getElementById('generator')!;
  const actions = document.getElementById('generation-actions')!;
  const generate = document.getElementById('generate') as HTMLButtonElement;
  const hint = document.getElementById('generation-hint')!;
  const scrollPositions = new Map<SidebarTask, number>();
  let active: SidebarTask = 'generate', generating = false, pending = false;

  function refreshActions() {
    actions.hidden = active !== 'generate' && !generating;
    generate.hidden = active !== 'generate';
    hint.hidden = active !== 'generate';
    generate.disabled = generating;
    generate.setAttribute('aria-busy', String(generating));
    document.getElementById('generate-label')!.textContent = generating ? '正在生成…' : '生成地图';
    hint.textContent = pending ? '参数已修改，点击生成以应用。' : '修改参数后，点击生成以应用。';
    sidebar.classList.toggle('has-pending-changes', pending);
    sidebar.classList.toggle('is-generating', generating);
  }

  function setCollapsed(collapsed: boolean) {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    collapse.setAttribute('aria-expanded', String(!collapsed));
    collapse.setAttribute('aria-label', collapsed ? '展开侧栏' : '收起侧栏');
    collapse.title = collapsed ? '展开侧栏' : '收起侧栏';
  }

  function selectTask(task: SidebarTask, notify = true) {
    scrollPositions.set(active, content.scrollTop);
    active = task;
    for (const item of tasks) {
      const tab = document.getElementById(`task-${item}`)!;
      const selected = item === task;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(`sidebar-${item}`)!.hidden = !selected;
    }
    content.scrollTop = scrollPositions.get(task) ?? 0;
    refreshActions();
    if (notify) document.dispatchEvent(new CustomEvent('sidebar-task-change', { detail: { task } }));
  }

  for (const task of tasks) {
    const tab = document.getElementById(`task-${task}`)!;
    tab.addEventListener('click', () => { setCollapsed(false); selectTask(task); });
    tab.addEventListener('keydown', event => {
      const index = tasks.indexOf(task);
      const next = event.key === 'ArrowRight' ? (index + 1) % tasks.length
        : event.key === 'ArrowLeft' ? (index + tasks.length - 1) % tasks.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tasks.length - 1 : -1;
      if (next === -1) return;
      event.preventDefault();
      setCollapsed(false); selectTask(tasks[next]);
      document.getElementById(`task-${tasks[next]}`)!.focus();
    });
  }
  collapse.addEventListener('click', () => setCollapsed(!document.body.classList.contains('sidebar-collapsed')));
  for (const event of ['input', 'change']) form.addEventListener(event, () => {
    pending = true; refreshActions();
  });
  document.addEventListener('map-view-change', event => {
    const { threeD } = (event as CustomEvent<{ threeD: boolean }>).detail;
    if (threeD && active !== 'three-d') selectTask('three-d', false);
    else if (!threeD && active === 'three-d') selectTask('generate', false);
  });
  selectTask(document.getElementById('view-three-d')?.getAttribute('aria-pressed') === 'true' ? 'three-d' : 'generate', false);

  return {
    setPending(value: boolean) { pending = value; refreshActions(); },
    setGenerating(value: boolean) { generating = value; refreshActions(); },
  };
}
