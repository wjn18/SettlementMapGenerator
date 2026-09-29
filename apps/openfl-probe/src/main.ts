import type Graphics from 'openfl/lib/openfl/display/Graphics';
import { Stage, Sprite, BitmapData, MouseEvent, Event, CapsStyle, JointStyle, LineScaleMode } from './openfl';
import { bitmapLabel } from './bitmap-font';
import fontUrl from '../../../legacy/TownGeneratorOS/Assets/maroubra.png?url';
import './style.css';

const host = document.querySelector<HTMLDivElement>('#map')!;
const metrics = document.querySelector<HTMLOutputElement>('#metrics')!;
const hover = document.querySelector<HTMLParagraphElement>('#hover')!;
const slider = document.querySelector<HTMLInputElement>('#zoom')!;
const palette = { paper: 0xccc5b8, light: 0x99948a, medium: 0x67635c, dark: 0x1a1917 };
const stage = new Stage(0, 0, palette.paper, undefined, {
  element: host, renderer: 'webgl2', allowHighDPI: true,
  context: { antialiasing: 4, preserveDrawingBuffer: true },
});
stage.frameRate = 60;
const scene = new Sprite();
stage.addChild(scene);
type XY = [number, number];
function path(g: Graphics, points: XY[], closed = false) {
  g.moveTo(...points[0]);
  for (const point of points.slice(1)) g.lineTo(...point);
  if (closed) g.lineTo(...points[0]);
}
const g = scene.graphics;
const road: XY[] = [[80, 665], [300, 550], [395, 405], [570, 290], [720, 115]];
g.lineStyle(18, palette.medium, 1, false, LineScaleMode.NORMAL, CapsStyle.NONE, JointStyle.ROUND);
path(g, road);
g.lineStyle(12, palette.paper, 1, false, LineScaleMode.NORMAL, CapsStyle.NONE, JointStyle.ROUND);
path(g, road);
const buildings: XY[][] = [
  [[195, 220], [300, 210], [315, 310], [210, 322]],
  [[335, 200], [433, 223], [410, 302], [328, 286]],
  [[213, 359], [311, 337], [330, 415], [231, 439]],
  [[454, 370], [568, 339], [592, 422], [470, 449]],
  [[432, 480], [546, 459], [572, 557], [451, 581]],
  [[245, 475], [289, 455], [311, 491], [270, 520]],
  [[351, 566], [411, 557], [422, 613], [362, 621]],
];
for (const building of buildings) {
  g.lineStyle(3, palette.dark);
  g.beginFill(palette.light);
  path(g, building, true);
  g.endFill();
}
const wall: XY[] = [[167, 180], [448, 156], [638, 317], [630, 565], [435, 668], [165, 543]];
g.lineStyle(7, palette.dark);
path(g, wall, true);
g.lineStyle();
g.beginFill(palette.dark);
for (const [x, y] of wall) g.drawCircle(x, y, 10);
g.endFill();
g.lineStyle(14, palette.dark, 1, false, LineScaleMode.NORMAL, CapsStyle.NONE);
path(g, [[260, 584], [294, 600]]);
const hit = new Sprite();
hit.graphics.beginFill(0, 0);
path(hit.graphics, [[185, 200], [322, 195], [334, 327], [197, 343]], true);
hit.graphics.endFill();
scene.addChild(hit);
let hitCount = 0;
const onOver = () => { hitCount++; hover.textContent = '命中：工匠街区'; };
const onOut = () => { hover.textContent = '尚未命中街区'; };
hit.addEventListener(MouseEvent.MOUSE_OVER, onOver);
hit.addEventListener(MouseEvent.MOUSE_OUT, onOut);
let fontMetrics: unknown = null;
function layout() {
  const zoom = Number(slider.value);
  const scale = Math.min(stage.stageWidth, stage.stageHeight) / 800 * zoom;
  scene.scaleX = scene.scaleY = scale;
  scene.x = (stage.stageWidth - 800 * scale) / 2;
  scene.y = (stage.stageHeight - 800 * scale) / 2;
  const canvas = host.querySelector('canvas');
  metrics.textContent = `CSS ${stage.stageWidth} × ${stage.stageHeight}\nDPR ${window.devicePixelRatio} · 缩放 ${zoom.toFixed(1)}×\n画布 ${canvas?.width} × ${canvas?.height}`;
}
stage.addEventListener(Event.RESIZE, layout);
slider.addEventListener('input', layout);
layout();
BitmapData.loadFromFile(fontUrl).onComplete(source => {
  const label = bitmapLabel(source, 'Small Town 12345', palette.dark);
  label.bitmap.x = 190;
  label.bitmap.y = 90;
  label.bitmap.scaleX = label.bitmap.scaleY = 3;
  scene.addChild(label.bitmap);
  fontMetrics = { width: label.width, height: label.height, glyphs: label.glyphs };
  document.body.dataset.ready = 'true';
}).onError(error => { metrics.textContent = `字体加载失败：${error}`; throw error; });

// Read-only probe measurements for browser acceptance, not the future renderer API.
Object.defineProperty(window, '__probe', { value: {
  get font() { return fontMetrics; },
  get hitCount() { return hitCount; },
  get stageSize() { return [stage.stageWidth, stage.stageHeight]; },
} });
