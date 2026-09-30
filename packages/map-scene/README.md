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

`themeFromCityPalette(JSON.parse(text))` 校验并转换参考网站的十色 JSON，包括字符串形式的 0–100 数值。`tintMethod: Overlay` 将暖色以叠加方式混入屋顶，`Spectrum` 按街区改变屋顶色相；`tintStrength` 控制强度。`weathering` 按建筑产生向纸色褪色的效果。外观噪声仅取决于地图种子及街区/建筑 ID，重绘和导出保持一致。这些是本项目的可移植近似算法，并非原网站纹理/做旧算法的复刻。所有效果在共享场景中计算，Canvas、SVG、OpenFL 与 PNG/SVG 导出使用同一组颜色；页面底部的种子说明是独立 UI，不包含在图片导出中。

主页面和并排比较页共用 `THEMES` / `THEME_LABELS` 的 12 套预设。可用 `?theme=turquoise` 等 URL 参数恢复配色。单元验证：`node --test tests/p3/*.test.mjs`（先构建包）；新增浏览器验证：`npx playwright test --config playwright.p5.config.ts tests/p5/themes.spec.ts`。

街区分色：`buildMapScene(town, theme, { districtColors: true })` 根据 `wardType` 分配颜色，工匠区陶土橙、平民区灰橄榄、城堡紫、商人区青绿、行政区蓝等。颜色由 `districtColor(theme, wardType)` 统一计算，同类街区保持同一色系，主题纸色参与少量混色。建筑只做小幅明暗变化，避免随机色相掩盖用途；街区地面铺淡色，使空广场和城堡院落也能区分。原始几何、种子、命中区域不变，三种渲染器与导出共享分色后的场景。调用库时默认关闭以保持兼容；主页面和比较页默认开启，可通过「街区分色」开关或 `districts=false` 关闭。图例只展示地图实际包含的类型，色块使用同一颜色函数；图例属于页面 UI，不包含在地图图片导出中。

`DrawCommand` 支持 polygon、polyline、circle；`Stroke` 显式保存颜色、宽度、world/screen 单位、端帽、连接和 miterLimit。`pointInRing(points, point)` 提供边界算内部的命中判断。`fitViewport(bounds, width, height, padding)` 返回 CSS 像素视口；DPR 属于绘制适配器。

地形算法 0.6.0 的海面与变宽河流使用真实多边形绘制；沿岸道路、桥面、港口栈桥进入同一组绘制指令，PNG/SVG 导出包含这些元素。旧河流 JSON 没有 `surface` 时仍按中心线和宽度绘制。场景独立复制 `terrain` 与 `river`，海面不命中街区，码头命中所属港区，桥面命中相邻岸边街区。港口仓储区提供独立的分区颜色与中文图例。

地名图层：`buildMapScene(town, theme, { labels: true })` 生成独立的 `scene.labels` 元数据，库调用默认关闭以兼容旧场景，主预览默认开启。`layoutMapLabels(scene, viewport, width, height, measure)` 使用调用方的字体测量函数，返回 CSS 像素位置的弧线字形，保持 map-scene 无 DOM 依赖。城市名固定在视口顶部，区域名沿区域主方向弯曲排列，按优先级尝试位置和字号，避开水面、桥梁及其他文字；无法清晰放下的区域名随缩放隐藏。长城市名先缩小字号，窄视口仍放不下时省略显示，完整名称保留在编辑器与 SVG title 中。

Canvas、SVG、OpenFL 共用布局与字体栈（Georgia / Times New Roman / Noto Serif CJK SC / SimSun / serif）。文字描边使用纸色，填充使用 label 或 dark。PNG 包含当前文字，SVG 保留逐字矢量文本和完整名称；系统字体会影响跨设备外观，SVG 不嵌入字体。悬停命中仍返回原地块 ID，UI 按 atlas 成员查找区域名与汇总信息。当前采用正面积、无洞多边形，不输出 DOM 指令。来源：watabou/TownGeneratorOS 的 mapping/CityMap.hx、Brush.hx、Palette.hx。

制图元素：`buildMapScene(town, theme, { cartography: { grid: true, scale: true, compass: true, gridSize: 100, metersPerUnit: 1 } })` 可加入网格、比例尺和罗盘。整个 cartography 选项省略时不输出辅助元素，兼容旧调用方；指定对象后，各开关默认为 true，gridSize 默认为 100 米，也接受 `'auto'`。metersPerUnit 是显示距离的换算系数，默认为 1，不缩放或修改 TownData。数值参数须为正有限数。

`layoutCartography(scene, viewport, width, height)` 返回 CSS 像素坐标的分层 `ScreenCommand`（图形或文本），与 DPR 无关，供三种绘制器共同使用。网格锁定世界原点，在缩放后最少保持约 40 像素间隔；固定网格过密时按 2 的幂合并，自动模式使用 1/2/5 距离。左下角比例尺长度严格等于距离 × zoom / metersPerUnit，刻度自动切换 m / km；右下角罗盘北向为世界 -Y，不随平移或缩放旋转。地名布局会避开比例尺与罗盘占用区域。窄视口缩小罗盘，小于 200 像素宽时省略角落元素。SVG 保留矢量路径和文本，PNG 包含相同的辅助元素；各开关互不依赖，且不改变命中结果。

独立消费已通过 P4：从实际 `.tgz` 安装 core 与 map-scene；完整示例及三个包的安装顺序见仓库 `examples/README.md`。

P5 版本 0.5.0 新增共享 MapRenderer 接口和 pickScene 命中工具；所有坐标约定不变，core 算法仍为 0.4.0。
