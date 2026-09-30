import type Stage from 'openfl/lib/openfl/display/Stage';
type BoundCallback = EventListener & { _m: (...args: unknown[]) => unknown; _s: unknown };
type Backend = { _c?: Record<string, BoundCallback>; [key: string]: unknown };
function callback(backend: Backend, name: string): BoundCallback | undefined {
  const method = backend[name] as { _i?: number } | undefined;
  return method?._i === undefined ? undefined : backend._c?.[method._i];
}
/** Compatibility cleanup for the pinned OpenFL 9.5.2 HTML5 backend.
 * Lime's public HTML5 exit() is empty: window.close alone leaves its RAF and
 * browser listeners running. Touch only callbacks belonging to this instance.
 */
export function disposeRuntime(stage: Stage): void {
  const win = stage.window, app = win.application;
  const backend = app.__backend as Backend;
  const key = callback(backend, 'handleKeyEvent'), windowEvent = callback(backend, 'handleWindowEvent');
  if (key) for (const event of ['keydown', 'keyup']) window.removeEventListener(event, key);
  if (windowEvent) for (const event of ['focus', 'blur', 'resize', 'beforeunload']) window.removeEventListener(event, windowEvent);
  const sensor = callback(backend, 'handleSensorEvent'); if (sensor) window.removeEventListener('devicemotion', sensor);
  const mouse = win ? callback(win.__backend as Backend, 'handleMouseEvent') : undefined;
  if (mouse) for (const event of ['mousemove', 'mouseup']) window.removeEventListener(event, mouse);
  // An already queued callback may fire once; replace its body so it cannot
  // schedule another frame or retain the disposed application.
  const frame = callback(backend, 'handleApplicationEvent');
  if (frame) { frame._m = () => undefined; frame._s = null; }
  stage.removeChildren(); app.removeModule(stage); app.removeModule(app); win?.close();
}
