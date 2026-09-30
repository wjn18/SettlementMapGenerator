# @settlement/map-scene

无 DOM、无 OpenFL 的绘制指令包，版本 `0.3.0`，GPL-3.0-only。先运行根目录的 `npm run build:packages`。

```ts
import { buildMapScene, THEMES, fitViewport } from '@settlement/map-scene';
const scene = buildMapScene(town, THEMES.parchment);
const viewport = fitViewport(scene.bounds, 800, 800, 32);
```

输入为经过 core 校验的 TownData 和主题，输出独立 `MapScene`（bounds、background、顺序 commands、hitRegions），不修改输入，不重新生成地图或消费随机数。主题为 parchment、blueprint、ancient、colour、ink、monochrome，颜色与笔画移植自旧版 Palette/Brush。

绘制顺序：外部道路双层描边 → 按地块绘制建筑/景物 → 城墙 → 城门 → 塔楼。城堡、教堂先绘制全部轮廓，再统一填充，避免共享边成为内部黑线。城区道路仍由留白表达。默认普通笔画 0.3、墙宽 1.8，世界单位。

`DrawCommand` 支持 polygon、polyline、circle；`Stroke` 显式保存颜色、宽度、world/screen 单位、端帽、连接和 miterLimit。`pointInRing(points, point)` 提供边界算内部的命中判断。`fitViewport(bounds, width, height, padding)` 返回 CSS 像素视口；DPR 属于绘制适配器。

当前采用正面积、无洞多边形，不输出字体或 DOM 指令。预览界面的图名和中文提示独立于地图图形。来源：watabou/TownGeneratorOS 的 mapping/CityMap.hx、Brush.hx、Palette.hx。
