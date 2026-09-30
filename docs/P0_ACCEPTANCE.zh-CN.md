# P0 验收记录

> 历史验收记录：旧版源码与专用工具已在迁移完成后移除。本文的 `verify:upstream`、`legacy:*`、`baseline:*` 命令仅适用于清理前提交；当前命令及历史复现入口见 [上游来源](UPSTREAM.md)。

验收日期：2026-09-29。结论：**P0 完成**。

本阶段按重构方案中“P0：方案与参考源码”的范围验收，交付的是迁移设计和可追溯的参考基线。

## 交付清单

| 验收项 | 交付物与结果 |
| --- | --- |
| 重构方案 | [REFACTOR_PLAN.zh-CN.md](REFACTOR_PLAN.zh-CN.md)：确定 TypeScript 内核、OpenFL 适配器、阶段顺序与验收标准 |
| 接口草案 | [API_DRAFT.zh-CN.md](API_DRAFT.zh-CN.md)：覆盖生成参数、错误、共享顶点 ID、JSON 数据和绘制接口；明确尚未实现、尚未冻结 |
| 上游可追溯性 | [UPSTREAM.md](UPSTREAM.md)：记录作者、仓库、完整提交哈希、导入范围和原依赖声明 |
| 参考源码 | [legacy/TownGeneratorOS](https://github.com/wjn18/SettlementMapGenerator/tree/72a554199cd775933f684ab55a2cf91562284ab4/legacy/TownGeneratorOS/)：固定提交的 64 个文件完整保留，无额外参考文件 |
| 许可证与作者声明 | 参考目录中的 LICENSE / README 以及[根许可证](../LICENSE)已与固定提交核对 |
| 可复查证据 | [upstream-manifest.json](upstream-manifest.json) 与 [verify-upstream.mjs](https://github.com/wjn18/SettlementMapGenerator/blob/72a554199cd775933f684ab55a2cf91562284ab4/scripts/verify-upstream.mjs)：提供每个文件的 Git blob ID、上游字节数和 SHA-256，以及离线校验入口 |
| 实施边界 | README、方案和本文均明确列出未实施、未运行事项 |

## 已执行验证

使用本机原仓库内的 Git 提交对象 `7fbc87a9398cc508af24de93f79cf2ad027f352b` 作为来源，逐项读取该提交的文件树和 blob，生成校验清单；未从副本反向生成期望哈希。

- 参考目录共 64 个文件，路径与上游文件树一致。
- 63 个文本文件仅存在 CRLF / LF 差异，统一为 LF 后内容全部一致。
- `Assets/maroubra.png` 与上游逐字节一致。
- 根目录 LICENSE 统一换行后与上游 LICENSE 一致。
- 原依赖声明为 Lime 7.3.0、OpenFL 8.9.0、msignal 1.2.5；Haxe 编译器版本未固定。

在项目目录执行：

```sh
node scripts/verify-upstream.mjs
```

结果：

```text
PASS: 64 upstream files and root LICENSE match 7fbc87a9398cc508af24de93f79cf2ad027f352b.
Text comparison normalizes CRLF to LF; binary files are compared byte for byte.
```

该命令只依赖 Node.js 内置模块，不要求 npm 安装、网络或原仓库仍在本机。校验覆盖缺失文件、额外文件和内容变化，失败以非零退出码返回；原构建输出目录 `Export/` 除外。它验证参考副本的完整性，不代表 Haxe 构建或生成算法测试通过。

## 尚未实施或运行

本次环境检查可找到 Node.js v24.19.0、npm 11.17.0；Haxe / haxelib 不在 PATH。这只是验收时的环境记录，不是 P1 锁定的工具链版本。

- 未恢复或运行旧 Haxe 构建，没有旧版截图、阶段输出或批量种子数据。
- 未安装或验证 OpenFL npm 版本，没有开发运行、生产打包、字体或 DPR 对照结果。
- 未实现 TypeScript 算法库、绘制适配器或可运行预览，也未发布 npm 包。
- 未进行性能测量、跨版本确定性或视觉一致性验收。

下一阶段是 P1：恢复旧版构建、完成最小 OpenFL npm 接入实验，并记录实际通过的版本和基线数据。P1 通过后再展开 P2 移植。
