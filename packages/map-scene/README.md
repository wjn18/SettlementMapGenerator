# @settlement/map-scene

无 DOM、无 OpenFL 的绘制指令包，版本 `0.5.0`，GPL-3.0-only。先运行根目录的 `npm run build:packages`。

```ts
import { buildMapScene, THEMES, fitViewport } from '@settlement/map-scene';
const scene = buildMapScene(town, THEMES.parchment);
const viewport = fitViewport(scene.bounds, 800, 800, 32);
```

输入为经过 core 校验的 TownData 和主题，输出独立 `MapScene`（bounds、background、顺序 commands、hitRegions），不修改输入，不重新生成地图或消费随机数。旧主题为 parchment、blueprint、ancient、colour、ink、monochrome，颜色与笔画移植自旧版 Palette/Brush。新增 modern、turquoise、fairytale、tapestry、natural、june，原始用户提供配色文件保存在 `src/palettes/city_*.json`，构建时原样带入包中。

绘制顺序：外部道路双层描边 → 按地块绘制建筑/景物 → 城墙 → 城门 → 塔楼。城堡、教堂先绘制全部轮廓，再统一填充，避免共享边成为内部黑线。城区道路仍由留白表达。默认普通笔画 0.3、墙宽 1.8，世界单位。

扩展主题先铺街区地面，再绘道路、河岸/河水、建筑/景物、城墙/门/塔和桥面。`MapTheme` 保留旧的四个必填色，并增加可选 `roof`（建筑）、`road`（道路与城区巷道底色、河岸和桥面）、`green`（公园/农庄地面）、`tree`（树丛）、`water`（喷泉和河流）、`wall`（城墙/门/塔与雕像）、`label`（预览图名/指南针）通道；`light` 用于广场和城堡院落，`dark` 用于轮廓，`paper` 用于背景。旧四色主题的无河流绘制指令保持兼容。河流由 core 的 `river: true` 生成；未指定水色的旧主题使用中间色与蓝色混合。地图水面不命中底下的街区，桥面保留命中行为。河流几何随场景复制，Canvas、SVG、OpenFL 与 PNG/SVG 导出共用。

`themeFromCityPalette(JSON.parse(text))` 校验并转换参考网站的十色 JSON，包括字符串形式的 0–100 数值。`tintMethod: Overlay` 将暖色以叠加方式混入屋顶，`Spectrum` 按街区改变屋顶色相；`tintStrength` 控制强度。`weathering` 按建筑产生向纸色褪色的效果。外观噪声仅取决于地图种子及街区/建筑 ID，重绘和导出保持一致。这些是本项目的可移植近似算法，并非原网站纹理/做旧算法的复刻。所有效果在共享场景中计算，Canvas、SVG、OpenFL 与 PNG/SVG 导出使用同一组颜色；预览图名/指南针仍是独立 UI，不包含在图片导出中。

主页面和并排比较页共用 `THEMES` / `THEME_LABELS` 的 12 套预设。可用 `?theme=turquoise` 等 URL 参数恢复配色。单元验证：`node --test tests/p3/*.test.mjs`（先构建包）；新增浏览器验证：`npx playwright test --config playwright.p5.config.ts tests/p5/themes.spec.ts`。

街区分色：`buildMapScene(town, theme, { districtColors: true })` 根据 `wardType` 分配颜色，工匠区陶土橙、平民区灰橄榄、城堡紫、商人区青绿、行政区蓝等。颜色由 `districtColor(theme, wardType)` 统一计算，同类街区保持同一色系，主题纸色参与少量混色。建筑只做小幅明暗变化，避免随机色相掩盖用途；街区地面铺淡色，使空广场和城堡院落也能区分。原始几何、种子、命中区域不变，三种渲染器与导出共享分色后的场景。调用库时默认关闭以保持兼容；主页面和比较页默认开启，可通过「街区分色」开关或 `districts=false` 关闭。图例只展示地图实际包含的类型，色块使用同一颜色函数；图例属于页面 UI，不包含在地图图片导出中。

`DrawCommand` 支持 polygon、polyline、circle；`Stroke` 显式保存颜色、宽度、world/screen 单位、端帽、连接和 miterLimit。`pointInRing(points, point)` 提供边界算内部的命中判断。`fitViewport(bounds, width, height, padding)` 返回 CSS 像素视口；DPR 属于绘制适配器。

当前采用正面积、无洞多边形，不输出字体或 DOM 指令。预览界面的图名和中文提示独立于地图图形。来源：watabou/TownGeneratorOS 的 mapping/CityMap.hx、Brush.hx、Palette.hx。

独立消费已通过 P4：从实际 `.tgz` 安装 core 与 map-scene；完整示例及三个包的安装顺序见仓库 `examples/README.md`。

P5 版本 0.5.0 新增共享 MapRenderer 接口和 pickScene 命中工具；所有坐标约定不变，core 算法仍为 0.4.0。
