# P2 验收记录

日期：2026-09-29。结论：P2 纯算法库完成。P3 正式地图绘制与交互、P4 最短路径修复和批量稳定性验收仍按计划推进。

## 实施结果

新增工作区包 `packages/core`（`@settlement/core@0.2.0`），输出 ESM 和 `.d.ts`，无运行时依赖。严格 TypeScript 编译仅使用 ES2022 类型库，没有 DOM 类型、Haxe 编译产物或 OpenFL 导入。

| 模块 | 责任 |
| --- | --- |
| `context.ts` | 实例随机数、预期几何错误、操作/数量预算 |
| `geometry.ts`、`voronoi.ts`、`cutter.ts` | Point、共享顶点 Polygon、Voronoi、切割 |
| `topology.ts` | 顶点图、旧版道路选择与稳定邻居顺序 |
| `model.ts` | 地块、交点优化、城墙、道路、街区分配、几何六阶段 |
| `wards.ts` | 13 种街区策略的显式注册表、评分和轮廓生成 |
| `generator.ts`、`options.ts` | 同步/分阶段入口、参数校验、有界重试 |
| `types.ts`、`export.ts`、`serialization.ts` | TownData、语义分类、稳定 ID、JSON 与引用校验 |

公开入口：`generateTown`、`generateTownSteps`、`serializeTown`、`deserializeTown`、`validateTown`、`createVertexIndex`、`hasVertexId`、`containsPoint`，以及类型和错误类。详见 [包使用说明](../packages/core/README.md)。算法移植按 GPL v3 保留来源说明，包内包含完整许可证。

生成调用独享随机数和可变模型；不再使用静态 Random、Model.instance 或反射创建街区。城墙、城门、道路和地块继续共享内部顶点，导出时统一映射为字符串 ID。`Ward.geometry` 按建筑、grove、statue、fountain 分开输出，避免把公园或广场装饰解释为房屋。

## 实际验证

环境：Windows x64、Node.js `24.19.0`（V8 `13.6.233.17-node.51`）、npm `11.17.0`、TypeScript `5.9.3`、Chrome `153.0.8010.53`。

| 命令 | 结果 |
| --- | --- |
| `npm run build` | core 类型声明与 ESM、既有 OpenFL 接入示例生产构建通过 |
| `npm run test:p2` | Node 原生 test runner：43 项通过 |
| `npm run test:p2:browser` | 1 项综合测试，覆盖 18 组旧版数据全部阶段及重试，逐字段精确一致；公开接口和浏览器重复生成也通过 |
| `npm run verify:upstream` | 64 个上游文件及根 LICENSE 未改变 |
| `npm run verify:fixtures` | P1 的 18 组阶段、19 张旧版截图、4 张接入截图及字体数据未改变 |
| `npm run generate -- 12345 24 artifacts/p2-sample.json` | 工作区包导入成功，输出 107 个地块、622 栋建筑的合法 JSON |

Node 的 43 项覆盖：18 组各自重复生成与 JSON 往返；18 组拓扑、重试、随机流和每地块轮廓数量对照；另外 7 项验证无浏览器全局变量、交错阶段调用及嵌套调用隔离、16 种显式开关/边界规模组合、非法输入和重试耗尽、资源上限及程序异常传播、损坏 JSON 拒绝、几何包含和切割面积。

无 DOM 测试在独立 Node 进程中运行：把 `window/document/navigator/openfl/performance` 设置成读取即抛错的属性，同时禁止 `Date` 和 `Math.random`，导入及生成仍成功。隔离测试轮流推进两个独立生成器，在中间插入第三次生成并修改返回快照；两个最终结果仍与各自独立调用的规范化 JSON 完全相同。

Node 测试只需要 `npm ci` 后的开发依赖；浏览器对照另需已安装 Chrome，可通过 `CHROME_PATH` 指定可执行文件。没有启动 Haxe/haxelib，P2 常规工作不依赖旧工具链。

## 兼容性与限制

1. 同一 Chrome 环境下，所有 18 组 P1 原始阶段精确相等；测试未放宽坐标、随机数、实体顺序或失败次数。这验证的是生成数据，不是 P3 地图渲染截图。
2. **不承诺不同 JS 引擎之间逐位复现。** 实测 Node 与 Chrome 在 320 个测试角度中有 22 个三角函数结果存在末位差异，例如 `Math.cos(6)` 分别为 `0.9601702866503661` 与 `0.960170286650366`。这些差异会传入建筑等长边选择；18 组中 9 组建筑阶段存在超过 `1e-8` 的差异或顶点数量差异。Node 对旧版的前五阶段采用坐标绝对误差 `1e-8`、其他字段精确相等，并检查最终随机状态和每地块轮廓数量。Node 自身重复生成与 JSON 往返仍精确一致。跨环境分发同一地图应传 JSON。
3. 为保持迁移可对照，仍保留旧版 FIFO 路径搜索，以及 `Polygon.distance` 实际返回首顶点距离的行为。Haxe ObjectMap 的数值 ID 枚举顺序以实例内节点序号还原。最短路径、鲁棒切割及更大种子集属于 P4；本阶段不声称对任意种子都能生成成功或所有轮廓都满足完整空间有效性。
4. 与旧版的明确区别是有界执行和公共数据验证：默认最多 20 次生成尝试（可设 1..100），累计 200 万计数操作、深度 128、5 万生成轮廓，多边形 buffer 每次 10 万步。非法导出几何作为预期失败重试，资源预算耗尽即返回，程序缺陷继续抛出。P1 样本均未触发新增限制或改变成功尝试次数。
5. 公共多边形环保留旧版正面积绕序，不重复首尾顶点。JSON 是独立数据快照，使用稳定 ID 保留引用；不尝试复活旧版类实例。单点道路不形成线段，导出时略去，入口顶点仍保留。内部预览用的 `arteries` 尚不作为独立 DTO 字段；公开 roads 保留主街与外部路径。
6. 正式地图预览、主题和 MapScene 尚未实现，`apps/openfl-probe` 仍为 P1 固定几何接入实验。独立 tarball 的跨项目消费、浏览器包交付、广泛种子压力测试和发布属于 P4，本阶段未执行 npm 发布。

## 复现

```sh
npm ci
npm run build
npm run test:p2
npm run test:p2:browser
npm run verify:upstream
npm run verify:fixtures
node scripts/generate-town.mjs 12345 24 town.json
```

命令行默认 seed=12345、size=24；不传输出路径时将 JSON 写入 stdout。生成失败将结构化错误写入 stderr，并以非零状态退出。
