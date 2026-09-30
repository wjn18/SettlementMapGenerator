# @settlement/renderer-svg

原生 SVG 绘制器，ESM + TypeScript 声明，版本 0.5.0，GPL-3.0-only。只依赖 map-scene 0.5.0；不依赖 OpenFL。浏览器使用，创建实例需要 DOM。

```ts
import { createSVGRenderer } from '@settlement/renderer-svg';
const renderer = createSVGRenderer(container);
renderer.resize(800, 800, devicePixelRatio);
renderer.render(scene);
renderer.setViewport({ centerX: 0, centerY: 0, zoom: 2 });
const district = renderer.pick(400, 400);
const xml = renderer.exportSVG(); // 独立 XML 字符串，含背景、当前视口和命名空间
renderer.dispose();
```

与共享 MapRenderer 接口一致：视口是世界中心与 CSS 像素/世界单位的缩放；pick 接受容器内 CSS 坐标。每条命令对应 path 或 circle，保留绘制顺序；world 线宽随变换，screen 使用 non-scaling-stroke。缩放/平移只更新组 transform，render 重建几何元素。resize 接受有限正宽高和 `(0,8]` 的 DPR；SVG 保持 CSS 尺寸，由浏览器按屏幕分辨率栅格化。

不修改 MapScene，不创建输入监听器或常驻 RAF；调用者负责交互和尺寸观察。dispose 幂等且清空/移除 SVG，销毁后其他方法抛错。exportSVG 只导出地图，不包含预览界面的字体和按钮；没有外部资源依赖，可继续在矢量编辑器中处理。

独立安装和评估见仓库 `examples/README.md`、`docs/P5_ACCEPTANCE.zh-CN.md`。已验证 Chrome；大图有较多 DOM 元素，完整场景重建与视口变换的成本不同，应分别测量。
