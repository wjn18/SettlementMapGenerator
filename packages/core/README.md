# @settlement/core

纯 TypeScript 城镇生成内核。ESM + 类型声明，零运行时依赖，不访问 DOM、OpenFL、系统时间或网络。基于 watabou/TownGeneratorOS 移植，GPL-3.0-only。当前包版本 `0.2.0`、算法版本 `0.2.0-legacy`、数据版本 `1`；尚未发布到 npm。

在仓库根目录执行 `npm ci`、`npm run build:core` 后，工作区中可直接调用：

```ts
import { generateTown, serializeTown, deserializeTown } from '@settlement/core';

const result = generateTown({ seed: 12345, size: 24 });
if (!result.ok) throw new Error(`${result.error.stage}: ${result.error.message}`);

const json = serializeTown(result.town);
const restored = deserializeTown(json);
console.log(restored.districts.length, restored.buildings.length);
```

`seed` 必填，整数 `1..2147483646`；`size` 必填，整数 `6..40`。`plaza`、`castle`、`walls` 为布尔值或默认的 `"auto"`。始终先按广场、城堡、城墙的顺序消耗三次随机数，再应用显式开关。`maxAttempts` 默认 20，允许整数 `1..100`。未知参数或范围外参数返回 `INVALID_OPTIONS`，不自动修正。

`generateTownSteps(options)` 返回生成器，每完成一个阶段产出 `{ attempt, stage }`，最终返回与 `generateTown` 相同的结果。使用 `.next()` 的 `done/value` 读取最终结果；`for...of` 只读取进度。可交错推进不同实例，调用 `.return()` 放弃生成。单个阶段仍同步执行，需避免长任务阻塞界面时由应用放入 Worker。

```ts
import { generateTownSteps } from '@settlement/core';

const steps = generateTownSteps({ seed: 42, size: 15 });
for (;;) {
  const next = steps.next();
  if (next.done) { console.log(next.value); break; }
  console.log(next.value.stage);
}
```

预期几何失败在本次局部随机流中重试，耗尽后返回 `GENERATION_FAILED`；预算耗尽返回 `RESOURCE_LIMIT`；程序异常继续抛出。每次调用最多 200 万个受计数操作、递归深度 128、5 万个生成轮廓（包含丢弃的中间结果），多边形 buffer 另有每次 10 万步上限。预算跨重试累计。

`TownData` 是独立快照，含请求与解析后的特征、稳定 ID、共享顶点表、地块、建筑、装饰/绿地、道路、城墙、城门、入口、中心与边界。内部 Point 对象不外泄。`createVertexIndex(town)` 可把同一 ID 解析为同一个顶点对象；`hasVertexId(ring, id)` 判断拓扑成员，`containsPoint(town, ring, point)` 判断几何包含，边界算内部。

`serializeTown` 先验证再按固定字段键序输出 JSON，不舍入坐标；`deserializeTown` 只接受数据格式 `1`，验证数量、有限坐标、正面积环、所有引用、城门关系和 bounds；失败抛出带 `INVALID_TOWN_DATA` 代码的 `TownDataError`。`validateTown(unknown)` 可单独验证。导入上限为 6400 万字符、25 万顶点、每类 10 万建筑/特征、4096 地块、单环 4096 个引用，总引用数 200 万；不支持多边形洞。

P2 保留旧版 FIFO 寻路和首顶点距离行为，尚未改成最短路径。生成道路保存旧版开放路径的顺序，两种道路宽度均为 2；只有一个顶点的零段路径不导出为道路，入口仍保留。普通小巷通过建筑留白表达。

复现保证限于相同算法版本、相同规范化输入和相同 JS 运行环境。Node 24 与 Chrome 153 的三角函数有末位差异，部分等长边的切割选择会不同；跨环境需要保持同一张地图时请传递 JSON。P2 已验证同 Chrome 环境下 18 组旧版完整阶段逐字段一致，见仓库 `docs/P2_ACCEPTANCE.zh-CN.md`。
