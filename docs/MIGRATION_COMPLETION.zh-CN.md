# 迁移核对与旧源码清理

日期：2026-09-30。

结论：按 [重构方案](REFACTOR_PLAN.zh-CN.md) 约定的 Web / TypeScript 迁移范围，未发现仍需由 Haxe 实现承担的功能。源码核对及下列回归验证通过后，旧版源码和专用工具已从当前源码树删除。算法版本仍为 0.4.0，绘制层仍为 0.5.0。

## 功能覆盖核对

| 原版职责 | 当前实现 | 核对依据 |
| --- | --- | --- |
| 种子、随机流、生成流程与重试 | `packages/core/src/context.ts`、`generator.ts`、`model.ts`、`options.ts` | 确定性、并行状态隔离、六阶段生成、错误与预算测试 |
| 地块、Voronoi、多边形切割 | `packages/core/src/geometry.ts`、`voronoi.ts`、`cutter.ts` | 旧版阶段对照、面积和拓扑不变量测试 |
| 道路、城墙、城门 | `packages/core/src/topology.ts`、`model.ts`、`pathfinding.ts` | 旧数据对照及独立最短路径用例；P4 已用 Dijkstra 替换旧 FIFO 寻路 |
| 各街区用途与建筑生成 | `packages/core/src/wards.ts` | 完整阶段对照、显式特征组合和建筑有效性测试 |
| 绘制层次、配色和命中 | `packages/map-scene`、三个 `renderer-*` 包 | 固定旧版数据截图、主题、缩放、命中和资源释放测试 |
| 启动、规模、种子 URL、按钮、悬停和自适应 | `apps/playground` | 开发 / 生产 × DPR 1/2 的交互测试 |
| 位图字体 | 两个应用的 TypeScript 字体布局与 `assets/fonts/maroubra.png` | 原始字体哈希与 OpenFL 实验中的字形布局验证 |
| 独立库、JSON、Worker、Canvas / SVG 导出 | core、map-scene、renderer 包与 playground | Node 无 DOM 调用、JSON 往返、Worker 取消及 PNG / SVG 导出测试 |

原版通用框架 `coogee/*`、`utils/*` 只迁移实际使用的行为，没有整体照搬未使用的工具类，这符合原方案。水域、三维建筑、原生 C++ 编译目标、经济模拟等不在约定迁移范围；没有将这些扩展计为待完成迁移。npm 发布和其他浏览器兼容验证也不是本次源码清理的前置条件。

## 清理范围

- 删除 59 个上游 `.hx` 文件，以及采集工具 `Baseline.hx`，当前开发源码中剩余 Haxe 文件为 0。
- 移除 `legacy/TownGeneratorOS/` 的受 Git 跟踪文件和 `tools/legacy-harness/`；字体原样迁入 `assets/fonts/`，两个应用同步修改导入。
- 删除 5 个旧版专用脚本：`setup-legacy.ps1`、`build-legacy.ps1`、`prepare-legacy.mjs`、`capture-legacy.mjs`、`verify-upstream.mjs`；同步移除对应 npm 命令。
- 新增 `verify:assets`，用保留的上游清单校验字体与根许可证。
- 保留根目录及各包许可证、作者来源、上游哈希清单、测试用的历史 FIFO 对照辅助代码、所有已审查的阶段数据和截图。
- 保留 TypeScript 的 OpenFL npm 适配器和接入实验；它们属于已完成的新实现，可用于三种绘制器的对照。
- 更新当前说明；历史验收记录增加适用版本提示，旧源码和工具的链接指向清理前提交。

本次只修改 `SettlementMapGenerator` 仓库。外层 `TwonGenerator` 是另一个 Git 仓库；本地被忽略的旧工具链、旧构建缓存及外层检出未改动，也不会进入新版仓库的提交。

删除前确认 71 个受跟踪的旧文件与清理前提交完全一致。它们可从提交 `72a554199cd775933f684ab55a2cf91562284ab4` 恢复；历史重新采集应在独立目录执行，见 [UPSTREAM.md](UPSTREAM.md)。

## 本次实际验证

以下验证在旧源码删除、字体迁移之后执行：

| 检查 | 结果 |
| --- | --- |
| `npm run verify:assets` | 字体原始字节和根许可证哈希通过 |
| `npm run verify:fixtures` | 18 组阶段数据、19 张旧版截图、4 张 OpenFL 截图及字体布局通过 |
| `npm run build` | 五个 TypeScript 库及 playground / OpenFL 实验生产构建通过 |
| `node --test tests/core/*.test.mjs tests/p3/scene.test.mjs tests/p4/*.test.mjs` | 57 项通过 |
| `npm run test:p2:browser` | 18 组历史阶段对照通过，当前算法输出独立校验通过 |
| `npx playwright test --config playwright.p5.config.ts` | 52 项通过，覆盖交互、固定图、Worker、绘制器切换和 PNG / SVG 导出 |
| P1 字体实验的四个项目 | 4 项通过；开发 / 生产 × DPR 1/2 |
| 当前源码扫描 | 无 `.hx`；apps / packages / scripts 无已删除旧目录或脚本引用 |

P1 的默认 5173 端口已有服务占用，因此使用 `artifacts/cleanup/probe.config.ts` 和临时 setup，将原测试原样运行于 5183 / 4183；未停止现有服务或修改正式测试配置。报告位于 `artifacts/cleanup/probe-report.json`，P5 报告位于 `artifacts/p5/playwright-results.json`。

生产构建仍提示 OpenFL 依赖的 `eval` 和较大 chunk；均为现有适配器依赖特征，本次没有改变依赖图或声称解决包体积。独立包消费和批量性能结论沿用 P4/P5 历史验收，本次未重新测量。
