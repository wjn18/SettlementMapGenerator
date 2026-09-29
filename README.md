# SettlementMapGenerator

面向多个项目复用的城镇地图生成器，首个演示目标为 Web。

拟采用 **TypeScript 算法库 + OpenFL 绘制适配层**。先沿用 OpenFL 的绘制能力和原项目的地图风格；后续用同一份地图数据比较原生 SVG、Canvas，再选择显示方案。

当前状态：**重构方案与原项目参考源码已整理；TypeScript 重构尚未实施。**

- [重构方案](docs/REFACTOR_PLAN.zh-CN.md)：模块边界、迁移阶段、验收标准与后续绘制方案对比。
- [接口草案](docs/API_DRAFT.zh-CN.md)：生成参数、地图数据、绘制接口与错误处理。
- [上游来源](docs/UPSTREAM.md)：参考版本、文件范围与许可证。
- [原项目源码](legacy/TownGeneratorOS/)：保留原 Haxe / OpenFL 实现，供迁移对照。

## 计划中的调用方式

以下为接口设计示意，目前不是可运行示例，也没有发布对应 npm 包：

```ts
const result = generateTown({ seed: 12345, size: 24 });

if (result.ok) {
  const scene = buildMapScene(result.town, theme);
  const renderer = createOpenFLRenderer(container);
  renderer.render(scene);
}
```

算法库将能够在不加载 OpenFL、DOM 或浏览器窗口的情况下生成地图。OpenFL 只用于浏览器预览，JSON 数据用于其他工具和平台接入。

## 当前构建状态

本次提交没有新增可运行的 TypeScript 工程，也未验证原 Haxe 项目的构建。原项目依赖声明保留在 `legacy/TownGeneratorOS/project.xml`；可复现构建与 OpenFL npm 接入实验列为第一实施阶段。

## 来源与许可

参考源码来自 [watabou/TownGeneratorOS](https://github.com/watabou/TownGeneratorOS)，保留其原始文件和 GPL v3 许可证文本，详见 [UPSTREAM.md](docs/UPSTREAM.md) 与 [LICENSE](LICENSE)。
