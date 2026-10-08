# SettlementMapGenerator

面向多个项目复用的城镇地图生成器，提供可直接使用的 Web 地图工坊，也可作为 TypeScript 算法库接入其他项目。当前已初步完成城镇生成，保留原项目的地图风格。

## 现有功能

| 功能 | 可以做什么 |
| --- | --- |
| 城镇生成 | 按种子生成地图，选择村落到都会的规模，配置城堡、广场和城墙，生成道路、街区与建筑。 |
| 河流、海岸与港城 | 支持河流、东南西北或自动方向的海岸，以及河口、桥梁、港区仓库和码头；港口可独立关闭。 |
| 地图浏览与配色 | 缩放、平移、悬停查看信息，切换图纸主题和街区分色；默认 Canvas 预览，也可切换 SVG / OpenFL，支持六组地图并排比较。 |
| 地名与区域 | 自动生成城市名与区域名，城堡和港区单独命名；可编辑中英文名称，并查看区域地块数、建筑数与用途。 |
| 地图辅助元素 | 独立开关网格、动态比例尺和八角罗盘；网格间距支持 25 / 50 / 100 / 200 米或自动。 |
| 人口估算 | 查看城区低 / 基准 / 高密度情景与区域分配，导出独立人口报告；城郊农地显示“未估算”。 |
| 保存、分享与导出 | 导入 / 导出地图 JSON，通过 URL 分享设置与地名，分别导出 PNG 图片和 SVG 矢量图，包含当前显示的地名及辅助元素。 |
| 算法库复用 | 在不依赖浏览器和 OpenFL 的环境中生成地图，通过 JSON 将实际几何交给其他工具或平台。 |

## 快速开始

### 启动地图工坊

需要 **Node.js >= 22.12.0**；已验证 Node.js 24.19.0 / npm 11.17.0.

以下命令均在 **`SettlementMapGenerator/` 目录（本 README 所在目录）**运行。

```sh
npm ci --cache .cache/npm
npm run dev
```

打开 [城镇地图工坊](http://127.0.0.1:5174)，即可开始生成地图。

### 生成、调整与保存

1. 调整种子、规模，以及河流、海岸、城堡、广场和城墙等选项，生成地图。生成在后台执行，可随时取消。
2. 滚轮缩放、拖动平移，悬停查看区域和街区信息。键盘方向键移动，`+` / `-` 缩放，`0` 复位。
3. 切换图纸主题；关闭「街区分色」可查看统一建筑配色。网格、比例尺和罗盘可在地图上方独立开关。
4. 点击地图选择区域，或点击右上角「编辑地名」，修改中英文名称。改名和切换人口情景均不会重新生成布局。
5. 使用独立的 PNG / SVG 按钮导出图片，或导出 JSON 保存地图。之后导入 JSON 可保留原始几何。

规模支持 **6–100 个基础城区地块**，预览提供以下档位：

| 村落 | 小镇 | 大镇 | 小城 | 中城 | 大城 | 都会 |
| --- | --- | --- | --- | --- | --- | --- |
| 6 | 12 | 24 | 40 | 60 | 80 | 100 |

数字表示基础地块数，墙内补建、城堡与水域裁切可能改变最终数量，实际值见「本次生成」。旧 URL / JSON 的其他合法规模仍可作为自定档位使用。

启动后可直接打开[河口港城示例](http://127.0.0.1:5174/?seed=42&size=24&coast=east&river=true&harbor=true&castle=true&plaza=true&walls=false&theme=modern&districts=false)。

常用 URL 参数：

| 参数 | 用途 |
| --- | --- |
| `seed`、`size` | 设置种子与基础城区地块数。 |
| `coast`、`river`、`harbor` | 配置海岸、河流与港口；示例使用 `coast=east&river=true&harbor=true`。 |
| `castle`、`plaza`、`walls` | 配置城堡、广场与城墙。 |
| `theme`、`districts`、`labels` | 设置主题、街区分色与地名显示，例如 `theme=modern&districts=false&labels=false`。 |
| `grid`、`scale`、`compass`、`gridSize` | 保留网格、比例尺、罗盘和网格间距设置。 |
| `population` | 选择人口情景：`sparse` / `typical` / `dense`，默认 `typical`。 |

算法升级可能改变同一 seed 的地图布局。需要保留某张地图，或在不同运行环境间传递同一布局时，请保存并导入 JSON。

## 调用算法库

完成依赖安装后，在本目录构建算法库：

```sh
npm run build:core
```

工作区可直接导入 `@settlement/core`；当前尚未发布 npm 包。

```ts
import { generateTown, serializeTown } from '@settlement/core';

const result = generateTown({ seed: 12345, size: 24 });

if (result.ok) {
  console.log(serializeTown(result.town));
} else {
  console.error(result.error);
}
```

也可通过命令行生成 JSON：

```sh
node scripts/generate-town.mjs 12345 24 town.json
```

完整 API 与数据说明见 [core 文档](packages/core/README.md)，独立项目接入与打包示例见 [examples](examples/README.md)。

## 技术实现

### 模块架构与数据

采用 **TypeScript 算法库 → 独立绘制指令 → Canvas / SVG / OpenFL 绘制器**的分层结构。当前 core 算法版本为 `0.11.0`，绘制层版本为 `0.5.0`。

| 模块 | 职责与文档 |
| --- | --- |
| `packages/core` | [生成算法与地图数据](packages/core/README.md)，不加载 OpenFL、DOM 或浏览器窗口。 |
| `packages/map-scene` | [独立绘制指令](packages/map-scene/README.md)，提供主题、地名与地图辅助元素的共享布局。 |
| `packages/renderer-canvas` | [Canvas 绘制器](packages/renderer-canvas/README.md)，用于默认预览。 |
| `packages/renderer-svg` | [SVG 绘制器](packages/renderer-svg/README.md)，用于矢量绘制与导出。 |
| `packages/renderer-openfl` | [OpenFL 适配层](packages/renderer-openfl/README.md)，保留作迁移对照。 |
| `apps/playground` | Web 地图工坊，在 Worker 中执行生成，提供交互、比较与导出。 |

预览、三种绘制器、PNG / SVG 与 JSON 共用实际几何。JSON 使用共享顶点 ID，可交给其他工具和平台。复现保证限于相同算法版本、输入和 JS 运行环境；跨 Node / Chrome 保持同一张地图时传递 JSON。旧地图可通过 JSON 原样导入，重新生成才会使用新算法。

### 道路引导生长与地形

算法 `0.11.0` 先预留弯曲的贯通道路和错位接入的支路，再沿道路方向细分可开发土地，从多个活动中心附近连续扩展城区。增长按道路距离、中心距离和相邻开发情况选择地块，外围保留凹入空地与沿路延伸，不再填满固定放射扇区或六边形外圈。

水域先裁出可建设陆地，再规划沿岸道路、桥梁和街区建筑；裁切后补足请求的陆地地块数。岸边路口优先作为桥头，并补齐街道片段之间必要的陆地连接。河流与海岸组合生成河口，港区沿岸生成仓储建筑与码头。

开放街区建筑靠近道路，背街逐渐留空，默认绘制不铺整块底色。主路约 15.2 m、支路与沿岸道路至少 10.4 m、普通街道 5.6 m，建筑避让道路和桥头。全部长度按规划坐标的 4 倍导出为米；导出后默认 1 地图单位 = 1 米，比例尺和人口计算不再叠加倍率。这是设计尺度，不是历史测绘校准。

40 以上的城市保留有限生成预算，默认最多重试 40 次；较小规模默认 20 次。

### 城墙、城堡与墙内用地

街区增长后，在生成街道、用途和建筑之前，固定核心城区与城堡的紧凑城墙包络。城墙围绕较早开发的核心区，较晚街区可在墙外。沿墙裁分原有乡野地块，较大的可建空间继续细分并接入街道，狭窄或零碎部分作为绿地；墙外保留乡野与沿路城郊。

建筑生成时预留沿墙通道，最后导出仅补齐塔楼、城门开口与道路连接，不再重新扩大墙线或删除建筑。墙内补建会增加实际城区地块数，规模选项仍表示基础地块数。人口只对已转为城区的陆地按既定密度公式估算，水面和墙外乡野不计入城区。

城堡合并为单栋建筑，并筛除过于不规则的轮廓。三种绘制器和 JSON 共用最终几何；旧 JSON 保留原图，重新生成后使用新城堡。

### 地名与地图辅助元素

相邻城区地块归为命名区域，城堡与港区单独命名。曲线地名随视口排版，避开水面、桥梁及其他标签，缩小时隐藏过密文字。地名随 JSON 和分享 URL 保存，PNG / SVG 导出包含当前显示的地名。旧版 JSON 自动补充显示名称，首次改名才写入命名数据。

网格、动态比例尺和八角罗盘在 Canvas / SVG / OpenFL 与 PNG / SVG 导出中共用布局。网格固定在地图坐标上，缩小到过密时按整倍数合并，并显示实际间距；比例尺按当前缩放选择整齐的距离刻度，自动使用 m / km；罗盘始终朝北。默认 1 地图单位 = 1 米的显示约定不改变城市几何。URL 保留辅助元素的显示设置，地图 JSON 继续保存城市数据。

### 人口估算口径

城区常住人口按 **城区用地公顷数 × 人口密度**计算。低 / 基准 / 高情景为 50 / 100 / 200 人/公顷，默认基准情景；人/栋仅用于对照。系数参考 [Buringh (2021), p. 8](https://researchdatajournal.org/article/download/24674/25863/63436) 的中世纪欧洲城市面积代理值，低、高情景不是统计置信区间。

用城区地块面积合计近似已居住城市用地，包含其中的道路、院落、市场和公园，当前生成地图的地块已裁去河海；默认 1 地图单位 = 1 米，尺度与城区范围未经历史校准。城郊农地不适用城市密度，明确显示“未估算”。

区域人数按城区建筑占地比例分配，市场、公园和装饰不参与分配。建筑仅影响分配，不影响总人口，不使用贫富街区人均面积、楼层或入住率系数。没有可分配建筑时，城区总估值保留，并显示未分配人数。

调整情景不改变地图布局，界面、悬停、区域详情及独立人口报告 JSON 同步。报告含文献、面积口径和假设，地图 JSON 保持不变。

## 开发与验证

以下命令同样在本 README 所在目录运行。依赖安装使用的 `.cache/npm` 缓存也供独立压缩包离线测试使用。

### 构建与生产预览

```sh
npm run build
npm run preview
```

`npm run preview` 在 [4174 端口](http://127.0.0.1:4174)预览生产产物。

### 回归与批量检查

```sh
npm run test:p4
npm run test:p4:batch
npm run test:p4:browser
npm run test:p4:packages
npm run verify:fixtures
```

浏览器测试使用本机 Chrome，覆盖开发 / 生产页面与 DPR=1/2。已保存的旧版地图基线继续用于回归测试。

| 专项检查 | 命令或测试位置 |
| --- | --- |
| 大城市规模 | `npm run test:sizes:batch`：检查 120 组大城市地形与城墙组合，报告保存至 `artifacts/city-sizes/batch.json`。 |
| 河流、海岸与港城 | `npm run test:terrain:batch`：检查 220 组水域组合；几何与连接测试见 `tests/core/terrain.test.mjs`，交互与导出测试见 `tests/p5/terrain.spec.ts`。 |
| 地图辅助元素 | 计算测试见 `tests/p3/cartography.test.mjs`，三种绘制器导出测试见 `tests/p5/cartography.spec.ts`。 |
| 人口估算 | 计算与交互测试见 `tests/core/population.test.mjs`、`tests/p5/population.spec.ts`。 |
| 字体、图片与许可资源 | `npm run verify:assets`：可离线校验，无需安装 npm 依赖；字体位于 `assets/fonts/`。 |

### 历史接入实验

P1 的 TypeScript / OpenFL npm 接入实验仍可通过 `npm run dev:probe`（5173）及 `npm run test:p1` 运行。历史 Haxe 基线的重新采集方式见 [上游来源](docs/UPSTREAM.md)。

## 来源与许可

算法与绘制语义移植自 [watabou/TownGeneratorOS](https://github.com/watabou/TownGeneratorOS)，继续保留作者来源、字体资源和 GPL v3 许可证文本，详见 [UPSTREAM.md](docs/UPSTREAM.md) 与 [LICENSE](LICENSE)。
