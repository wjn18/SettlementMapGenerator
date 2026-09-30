# SettlementMapGenerator

面向多个项目复用的城镇地图生成器，首个演示目标为 Web。

采用 **TypeScript 算法库 + 独立绘制指令 + Canvas 默认预览 / SVG 矢量导出**。保留原项目的地图风格，以及 OpenFL 适配层供迁移对照。

当前状态：**P0–P5 已完成；旧版 Haxe 源码及专用构建工具已退出当前源码树。** 已选定 Canvas 默认预览、SVG 矢量导出。core 算法保持 0.4.0，绘制层升级 0.5.0；预览提供独立 PNG / SVG 导出按钮，支持切换 OpenFL / Canvas / SVG，以及六组地图的并排细节比较。日常开发和测试无需 Haxe 工具链。

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

打开 [城镇地图工坊](http://127.0.0.1:5174)。调整种子和规模生成地图，切换图纸主题，滚轮缩放、拖动平移、悬停查看街区。生成在后台 Worker 中执行，可随时取消。JSON 导入保留原始几何，导出可用于其他平台。键盘方向键移动、`+`/`-` 缩放、`0` 复位。

```sh
npm run build
npm run test:p4:browser
npm run test:p4:packages
npm run verify:fixtures
```

浏览器测试使用本机 Chrome，覆盖开发 / 生产页面与 DPR=1/2。`npm run preview` 在 4174 预览生产产物。P1 的 TypeScript / OpenFL npm 接入实验仍可通过 `npm run dev:probe`（5173）及 `npm run test:p1` 运行。历史 Haxe 基线的重新采集方式见 [上游来源](docs/UPSTREAM.md)。

## 来源与许可

算法与绘制语义移植自 [watabou/TownGeneratorOS](https://github.com/watabou/TownGeneratorOS)，继续保留作者来源、字体资源和 GPL v3 许可证文本，详见 [UPSTREAM.md](docs/UPSTREAM.md) 与 [LICENSE](LICENSE)。
