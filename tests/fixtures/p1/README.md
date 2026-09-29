# P1 参考数据

由原上游提交 `7fbc87a9398cc508af24de93f79cf2ad027f352b`、锁定的 Haxe 工具链和 Chrome 153.0.8010.53 实际生成。复现命令和环境限制见 [P1 验收记录](../../../docs/P1_ACCEPTANCE.zh-CN.md)。

## 文件

- `legacy/report.json`：18 组样本的参数、实际特征、尝试次数、数量和 SHA-256。
- `legacy/seed-*-size-*.json.gz`：每组地图的原始阶段 JSON，使用 gzip 压缩以减少体积；SHA-256 针对解压后的原始 UTF-8 字节。
- `legacy/*-dpr1.png`：800×800 原版截图；另有 `seed-12345-size-24-dpr2.png`，实际尺寸为 1600×1600。
- `probe/`：固定绘制样本的开发 / 生产 × DPR=1/2 截图和实测参数，采用原字体图片。
- `playwright-results.json`：本次浏览器验收结果。报告里的运行路径是当时的本机路径，不作为可移植的源码链接。

## 阶段格式

`format` 为 `legacy-stage-baseline-1`，不是未来的 `TownData`。

`attempts` 按原版生成尝试排列。每次尝试记录已完成的 `stages` 和失败信息 `error`；最终尝试包含六阶段，依次为 `buildPatches`、`optimizeJunctions`、`buildWalls`、`buildStreets`、`createWards`、`buildGeometry`。后两项对应方案中的街区用途分配和建筑几何生成。

每个快照的 `vertices` 保存当时的坐标；其他字段引用同一快照内的顶点 ID。ID 按首次遍历顺序分配，通过对象身份判定共享，不合并坐标相同的独立点。ID 只在当前快照中有意义，不保证跨阶段恒定。`patches[].geometry` 仍保留原 Ward 的混合语义，包括房屋、绿地等；不能直接视为建筑列表。

`randomState` 是该阶段完成时的 PRNG 状态；`features` 是原构造函数的实际特征选择。快照不会修改模型、调用随机数或保存可变对象引用。每组观测版运行两次的 JSON 完全相同，且与未修改源码的原版截图完全相同。

示例读取：

```js
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const data = JSON.parse(gunzipSync(readFileSync(
  'tests/fixtures/p1/legacy/seed-12345-size-24.json.gz'
)).toString('utf8'));
console.log(data.attempts.at(-1).stages.at(-1));
```

## 复核与更新

`npm run verify:fixtures` 离线检查已保存数据和截图的完整性、样本覆盖及字体布局。`npm run baseline:verify` 使用已构建的原版和观测版重新生成，并检查阶段哈希；`npm run test:p1` 检查当前 npm 示例。

如需有意更新基线，先运行 `npm run baseline:capture`，检查 `artifacts/p1/legacy/` 的差异、报告和截图，再将经过审查的结果复制到本目录。不得通过自动覆盖期望值使回归测试通过。更换编译器、浏览器或算法时，需要在验收记录中说明原因；P2 移植结果应保存在独立位置，保留本 Haxe 基线。
