# SettlementMapGenerator

面向多个项目复用的城镇地图生成器，首个演示目标为 Web。

拟采用 **TypeScript 算法库 + OpenFL 绘制适配层**。先沿用 OpenFL 的绘制能力和原项目的地图风格；后续用同一份地图数据比较原生 SVG、Canvas，再选择显示方案。

当前状态：**P0、P1、P2 已完成。纯 TypeScript 内核可在 Node.js 无 DOM 环境生成地图；正式地图预览属于下一阶段 P3。**

- [重构方案](docs/REFACTOR_PLAN.zh-CN.md)：模块边界、迁移阶段、验收标准与后续绘制方案对比。
- [接口草案](docs/API_DRAFT.zh-CN.md)：生成参数、地图数据、绘制接口与错误处理。
- [上游来源](docs/UPSTREAM.md)：参考版本、文件范围与许可证。
- [原项目源码](legacy/TownGeneratorOS/)：保留原 Haxe / OpenFL 实现，供迁移对照。
- [P0 验收记录](docs/P0_ACCEPTANCE.zh-CN.md)：交付清单、源码完整性验证与尚未运行的项目。
- [P1 验收与复现](docs/P1_ACCEPTANCE.zh-CN.md)：锁定工具链、构建命令、18 组旧版基线与浏览器实验结果。
- [P2 验收记录](docs/P2_ACCEPTANCE.zh-CN.md)：43 项 Node 测试、18 组完整旧版阶段对照、JSON 与状态隔离。
- [算法包使用说明](packages/core/README.md)：生成、分阶段调用、数据校验及复现边界。
- [基线数据说明](tests/fixtures/p1/README.md)：阶段 JSON、截图、哈希和更新规则。

在本目录运行 `node scripts/verify-upstream.mjs` 可离线校验 64 个参考文件及根许可证，无需安装 npm 依赖。文本仅统一 CRLF / LF 后比较，图片按原始字节比较。

## 调用算法库

在仓库根目录运行 `npm ci`、`npm run build:core` 后，工作区可直接导入；尚未发布 npm 包：

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
npm run test:p2
npm run test:p2:browser
node scripts/generate-town.mjs 12345 24 town.json
```

## 运行 OpenFL 接入示例

在本目录运行（已验证 Node.js 24.19.0 / npm 11.17.0）：

```sh
npm ci
npm run dev
```

打开 [本地接入示例](http://127.0.0.1:5173)。本页使用固定几何测试 OpenFL、字体、透明命中区域和缩放；P3 再接入已实现的 TypeScript 生成器。

```sh
npm run build
npm run test:p1
npm run verify:fixtures
```

浏览器测试使用本机 Chrome，覆盖开发 / 生产页面与 DPR=1/2。旧版构建在 Windows x64 上使用项目内工具链，依次运行 `npm run legacy:setup`、`npm run legacy:build`、`npm run legacy:build:instrumented`、`npm run baseline:verify`。详情和已知工具链提示见 P1 验收文档。

## 来源与许可

参考源码来自 [watabou/TownGeneratorOS](https://github.com/watabou/TownGeneratorOS)，保留其原始文件和 GPL v3 许可证文本，详见 [UPSTREAM.md](docs/UPSTREAM.md) 与 [LICENSE](LICENSE)。
