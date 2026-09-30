# SettlementMapGenerator

面向多个项目复用的城镇地图生成器，首个演示目标为 Web。

采用 **TypeScript 算法库 + 独立绘制指令 + Canvas 默认预览 / SVG 矢量导出**。保留原项目的地图风格，以及 OpenFL 适配层供迁移对照。

当前状态：**P0–P5 已完成；旧版 Haxe 源码及专用构建工具已退出当前源码树。** 已选定 Canvas 默认预览、SVG 矢量导出。core 算法升级 0.10.0，绘制层为 0.5.0；预览提供独立 PNG / SVG 导出按钮，支持切换 OpenFL / Canvas / SVG，以及六组地图的并排细节比较。日常开发和测试无需 Haxe 工具链。

新增地形与港城生成：海岸支持东、南、西、北及自动方向；河流与海岸组合生成河口，港口可独立关闭。水域先裁出可建设陆地，再规划沿岸道路、桥梁和街区建筑；港区沿岸生成仓储建筑与码头。预览、三种绘制器、PNG / SVG 与 JSON 共用实际几何。算法版本为 `0.10.0`，城堡合并为单栋建筑并筛除过于不规则的轮廓；旧地图可通过 JSON 原样导入，重新生成后使用新城堡。

道路引导生长（0.10.0）：先预留弯曲的贯通道路和错位接入的支路，再沿道路方向细分可开发土地，从多个活动中心附近连续扩展城区。增长按道路距离、中心距离和相邻开发情况选择地块，外围保留凹入空地与沿路延伸；不再填满固定放射扇区或六边形外圈。城墙在街区增长后沿较早开发的核心区生成，较晚街区可在墙外；开放街区建筑靠近道路，背街逐渐留空，默认绘制不铺整块底色。水域裁切后补足请求的陆地地块数，岸边路口优先作为桥头，补齐街道片段之间必要的陆地连接。主路约 15.2 m、支路与沿岸道路至少 10.4 m、普通街道 5.6 m；建筑继续避让道路和桥头。全部长度按规划坐标的 4 倍导出为米，这是设计尺度，不是历史测绘校准。人口继续采用 50 / 100 / 200 人/公顷；人/栋仅用于对照。

城墙轮廓（0.10.0）：以核心城区和城堡的紧凑外包络生成独立墙线，跨过地块的小凹槽，不再逐边描摹街区。墙线为不规则的直线段组合，按距离设置塔楼；道路穿墙处写入共享城门顶点并留出实际开口，河海处断开墙段。建筑和装饰避让墙线与塔楼所需走廊，城内外标记按新包络重算；人口仍按城区地块面积计算，不把墙内新包入的空地当新增城区面积。JSON 保存最终墙线、城门与道路连接，旧 JSON 原样保留。

城镇规模支持 6–100 个基础城区地块。预览档位为村落 6、小镇 12、大镇 24、小城 40、中城 60、大城 80、都会 100；旧 URL / JSON 的其他合法规模仍可作为自定档位使用。数字表示基础地块数，城堡、城门街区与水域裁切可能改变最终数量，实际值见「本次生成」。40 以上的城市保留有限生成预算与默认 40 次重试；较小规模默认 20 次。骨架生成方式会改变同一 seed 的新地图，要保留旧布局请导入保存的 JSON。运行 `npm run test:sizes:batch` 检查 120 组大城市地形与城墙组合，报告保存至 `artifacts/city-sizes/batch.json`。

港城示例：`/?seed=42&size=24&coast=east&river=true&harbor=true&castle=true&plaza=true&walls=false&theme=modern&districts=false`。关闭「街区分色」可查看统一建筑配色。运行 `npm run test:terrain:batch` 检查 220 组水域组合；几何与连接测试位于 `tests/core/terrain.test.mjs`，浏览器交互与导出测试位于 `tests/p5/terrain.spec.ts`。

新增地名与区域：自动生成城市名，把相邻城区地块归为命名区域，城堡与港区单独命名。曲线地名随视口排版，避开水面、桥梁及其他标签；缩小地图时隐藏过密文字。点击地图选择区域，或点击右上角「编辑地名」，可修改中文或英文名称，并查看地块数、建筑数与用途。改名不重新生成布局；地名随 JSON 和分享 URL 保存，PNG / SVG 导出包含当前显示的地名。「地名」开关（`labels=false`）可隐藏文字。旧版 JSON 自动补充显示名称，首次改名才写入命名数据。

地图辅助元素：网格、动态比例尺、八角罗盘可在地图上方独立开关，Canvas / SVG / OpenFL 与 PNG / SVG 导出共用布局。网格固定在地图坐标上，间距可选 25 / 50 / 100 / 200 米或自动；缩小到过密时按整倍数合并，并显示实际间距。比例尺按当前缩放选择整齐的距离刻度，自动使用 m / km；罗盘始终朝北。默认采用 1 个地图单位 = 1 米的显示约定，不改变城市几何。URL 用 `grid`、`scale`、`compass` 和 `gridSize` 保留显示设置；JSON 继续保存城市数据。网格与比例尺的计算和三种绘制器导出测试见 `tests/p3/cartography.test.mjs`、`tests/p5/cartography.spec.ts`。

人口估算：按城区用地公顷数 × 人口密度计算城区常住人口，低 / 基准 / 高情景为 50 / 100 / 200 人/公顷，默认基准情景。系数参考 [Buringh (2021), p. 8](https://researchdatajournal.org/article/download/24674/25863/63436) 的中世纪欧洲城市面积代理值；低、高情景不是统计置信区间。用城区地块面积合计近似已居住城市用地，包含其中的道路、院落、市场和公园，当前生成地图的地块已裁去河海；默认 1 地图单位 = 1 米，尺度与城区范围未经历史校准。城郊农地不适用城市密度，明确显示“未估算”。区域人数按城区建筑占地比例分配，市场、公园和装饰不参与分配；建筑仅影响分配，不影响总人口，不使用贫富街区人均面积、楼层或入住率系数。没有可分配建筑时，城区总估值保留，并显示未分配人数。URL 参数 `population=sparse|typical|dense` 保留选择，调整情景不改变地图布局。界面、悬停、区域详情及独立人口报告 JSON 同步；报告含文献、面积口径和假设，地图 JSON 保持不变。计算与交互测试见 `tests/core/population.test.mjs`、`tests/p5/population.spec.ts`。

- [重构方案](docs/REFACTOR_PLAN.zh-CN.md)：模块边界、迁移阶段、验收标准与后续绘制方案对比。
- [接口草案](docs/API_DRAFT.zh-CN.md)：生成参数、地图数据、绘制接口与错误处理。
- [上游来源](docs/UPSTREAM.md)：参考版本、文件范围与许可证。
- [迁移核对与源码清理](docs/MIGRATION_COMPLETION.zh-CN.md)：功能覆盖、清理范围与验证结果；原实现可从 Git 历史追溯。
- [P0 验收记录](docs/P0_ACCEPTANCE.zh-CN.md)：交付清单、源码完整性验证与尚未运行的项目。
- [P1 验收与复现](docs/P1_ACCEPTANCE.zh-CN.md)：锁定工具链、构建命令、18 组旧版基线与浏览器实验结果。
- [P2 验收记录](docs/P2_ACCEPTANCE.zh-CN.md)：43 项 Node 测试、18 组完整旧版阶段对照、JSON 与状态隔离。
- [P3 验收记录](docs/P3_ACCEPTANCE.zh-CN.md)：真实地图预览、6 项场景测试、16 项浏览器测试与旧版截图对照。
- [P4 验收记录](docs/P4_ACCEPTANCE.zh-CN.md)：620 组批量输入、独立 npm 压缩包消费、Worker 与资源释放。
- [独立 Node / 浏览器示例](examples/README.md)：本地压缩包安装与调用。
- [P5 验收与性能对照](docs/P5_ACCEPTANCE.zh-CN.md)：54 组截图/测量、依赖体积与资源比较。
- [打开并排比较](http://127.0.0.1:5174/compare.html)：六个固定样本、8× 细节镜头及差异着色。
- [算法包使用说明](packages/core/README.md)：生成、分阶段调用、数据校验及复现边界。
- [基线数据说明](tests/fixtures/p1/README.md)：阶段 JSON、截图、哈希和更新规则。

在本目录运行 `npm run verify:assets` 可离线校验保留的字体图片及根许可证，无需安装 npm 依赖。字体位于 `assets/fonts/`，已保存的旧版地图基线继续用于回归测试。

## 调用算法库

在仓库根目录运行 `npm ci --cache .cache/npm`、`npm run build:core` 后，工作区可直接导入；缓存也供独立压缩包离线测试使用。尚未发布 npm 包：

```ts
import { generateTown, serializeTown } from '@settlement/core';

const result = generateTown({ seed: 12345, size: 24 });

if (result.ok) {
  console.log(serializeTown(result.town));
} else {
  console.error(result.error);
}
```

算法库不加载 OpenFL、DOM 或浏览器窗口。JSON 使用共享顶点 ID，可交给其他工具和平台。复现保证限于相同算法版本、输入和 JS 运行环境；跨 Node / Chrome 保持同一张地图时传递 JSON。

```sh
npm run test:p4
npm run test:p4:batch
node scripts/generate-town.mjs 12345 24 town.json
```

## 运行地图预览

在本目录运行（已验证 Node.js 24.19.0 / npm 11.17.0）：

```sh
npm ci --cache .cache/npm
npm run dev
```

打开 [城镇地图工坊](http://127.0.0.1:5174)。调整种子和规模生成地图，切换图纸主题，滚轮缩放、拖动平移、悬停查看区域和街区信息、点击区域编辑地名。生成在后台 Worker 中执行，可随时取消。JSON 导入保留原始几何，导出可用于其他平台。键盘方向键移动、`+`/`-` 缩放、`0` 复位。

```sh
npm run build
npm run test:p4:browser
npm run test:p4:packages
npm run verify:fixtures
```

浏览器测试使用本机 Chrome，覆盖开发 / 生产页面与 DPR=1/2。`npm run preview` 在 4174 预览生产产物。P1 的 TypeScript / OpenFL npm 接入实验仍可通过 `npm run dev:probe`（5173）及 `npm run test:p1` 运行。历史 Haxe 基线的重新采集方式见 [上游来源](docs/UPSTREAM.md)。

## 来源与许可

算法与绘制语义移植自 [watabou/TownGeneratorOS](https://github.com/watabou/TownGeneratorOS)，继续保留作者来源、字体资源和 GPL v3 许可证文本，详见 [UPSTREAM.md](docs/UPSTREAM.md) 与 [LICENSE](LICENSE)。
