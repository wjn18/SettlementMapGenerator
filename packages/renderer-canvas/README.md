# @settlement/renderer-canvas

原生 Canvas 2D 绘制器，ESM + TypeScript 声明，版本 0.5.0，GPL-3.0-only。只依赖 map-scene 0.5.0；不依赖 OpenFL。浏览器使用，Node 可导入但创建实例需要 DOM。

```ts
import { createCanvasRenderer } from '@settlement/renderer-canvas';
const renderer = createCanvasRenderer(container);
renderer.resize(800, 800, devicePixelRatio);
renderer.render(scene);
renderer.setViewport({ centerX: 0, centerY: 0, zoom: 2 });
const district = renderer.pick(400, 400);
const png = await renderer.exportPNG(); // Blob，包含背景，尺寸为 CSS 大小 × DPR
renderer.dispose();
```

与共享 MapRenderer 接口一致：视口是世界中心与 CSS 像素/世界单位的缩放；pick 接受容器内 CSS 坐标。世界线宽随缩放，screen 线宽保持 CSS 像素大小。命令顺序、闭合路径、线帽和拐角样式逐条执行；不修改 MapScene 或消耗随机数。调用者必须保持场景只读。

容器应有明确尺寸；resize 的宽高必须为有限正数，DPR 为 `(0,8]`。调用者负责 ResizeObserver 和交互。视口改变时全量重绘，无常驻 RAF 或事件监听。dispose 幂等，移除画布并清空其 backing store；销毁后调用其他方法抛错。

独立安装和评估见仓库 `examples/README.md`、`docs/P5_ACCEPTANCE.zh-CN.md`。已验证 Chrome，未承诺所有浏览器的抗锯齿逐像素相同。
