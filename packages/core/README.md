# @settlement/core

纯 TypeScript 城镇生成内核。ESM + 类型声明，零运行时依赖，不访问 DOM、OpenFL、系统时间或网络。基于 watabou/TownGeneratorOS 移植，GPL-3.0-only。当前包版本 `0.4.0`、算法版本 `0.7.0`、数据版本 `1`；尚未发布到 npm。

在仓库根目录执行 `npm ci`、`npm run build:core` 后，工作区中可直接调用：

```ts
import { generateTown, serializeTown, deserializeTown } from '@settlement/core';

const result = generateTown({ seed: 12345, size: 24 });
if (!result.ok) throw new Error(`${result.error.stage}: ${result.error.message}`);

const json = serializeTown(result.town);
const restored = deserializeTown(json);
console.log(restored.districts.length, restored.buildings.length);
```

`seed` 必填，整数 `1..2147483646`；`size` 必填，整数 `6..100`，表示基础城区地块数。城堡、城门附近新增街区以及水域裁切可能改变最终城区地块数；地块数不是建筑数或人口。`plaza`、`castle`、`walls` 为布尔值或默认的 `"auto"`。始终先按广场、城堡、城墙的顺序消耗三次随机数，再应用显式开关。`maxAttempts` 在 `size <= 40` 时默认 20，更大规模默认 40，允许显式指定整数 `1..100`。未知参数或范围外参数返回 `INVALID_OPTIONS`，不自动修正。

可选 `river: true` 启用沿河城市，`coast: 'auto' | 'east' | 'south' | 'west' | 'north'` 启用海岸，两者组合生成河口。`coast: false` 或省略关闭海岸。沿海默认生成港区与码头，`harbor: false` 可关闭；内陆时该选项不产生码头。水域启用时使用地形算法 `TERRAIN_GENERATOR_VERSION = '0.7.0'`：先规划海岸和变宽河流、预留干燥的城堡/广场，再裁出陆地街区，在共享边界上构建街道、滨水道路和连接两岸的桥梁，最后细分建筑。码头从港区岸边道路伸向海面，避开河口。关闭水域使用 `GENERATOR_VERSION = '0.7.0'`。当前支持单条河流和一侧海岸，不包含支流、岛屿、湖泊或水文模拟。

城堡在算法 0.7.0 中输出为一栋建筑：先合并细分块、删除内部接缝和共线节点，再筛选轮廓。仅接受单个无孔洞、无自交的连续轮廓；最多 12 个角，紧凑度至少 0.55，最小包围矩形长宽比不超过 2.5，占矩形面积至少 60%，占城堡可建地块至少 30%，拒绝小于 40° 的尖角和过短边。最多局部重试 64 次，仍不合格时进入受 `maxAttempts` 限制的整图重试。额外候选不消耗后续地块的随机序列。JSON、预览及各绘制器共用同一轮廓；旧 JSON 保留原几何，需要重新生成才能采用新城堡。

`TownData.river` 保存 `centerline`、参考 `width`、`bankWidth`、`bridges` 和实际水面多边形 `surface`（旧地图可以省略 surface）。`TownData.terrain.coast` 保存最终海岸方向、岸线和海面多边形；`waterfronts` 引用沿岸道路；`docks` 保存港区 ID、连接道路 ID、路径和宽度。所有几何使用世界坐标，不泄露内部 Point 对象。道路通常宽 2、沿岸道路宽 2.6、桥梁道路宽 3；桥面宽 3.5。新增 `Harbor` 街区类型。数据格式仍为 `1`，新增字段是可选的，新版可无损导入旧地图；旧版严格校验器不支持新增字段。JSON 保存实际几何，无须重生成。`generateTownSteps` 在道路/建筑之前产出 `terrain` 阶段。河流生成算法已变化，要保留旧版河流布局请导入原始 JSON。

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

导出前检查建筑/特征不越出地块，越界与其他预期几何失败在本次局部随机流中重试，耗尽后返回 `GENERATION_FAILED`；预算耗尽返回 `RESOURCE_LIMIT`；程序异常继续抛出。`size <= 40` 每次调用最多 200 万个受计数操作、5 万个生成轮廓（包含丢弃的中间结果）；更大规模按 `(size / 40)²` 放大这两个预算，100 地块上限为 1250 万步、312500 个轮廓。递归深度仍为 128，多边形 buffer 每次最多 10 万步，预算跨重试累计。新规模的城堡限制细分密度，以便合并出单栋规整建筑；6–40 规模的预算与几何行为保持原样。

`TownData` 是独立快照，含请求与解析后的特征、稳定 ID、共享顶点表、地块、建筑、装饰/绿地、道路、城墙、城门、入口、中心与边界。内部 Point 对象不外泄。`createVertexIndex(town)` 可把同一 ID 解析为同一个顶点对象；`hasVertexId(ring, id)` 判断拓扑成员，`containsPoint(town, ring, point)` 判断几何包含，边界算内部。

新生成地图包含可选 `TownData.atlas`：`{ version: '1', cityName, regions }`。每个命名区域保存 `id`、`name`、`kind`（quarter / harbor / citadel）及 `districtIds`；所有城区地块恰好归入一个区域。自动分组沿共享陆地边界连接，不跨河流，城堡与港区独立成组。命名使用独立哈希，不消耗几何随机数，不改变现有道路和建筑结果。

`createTownAtlas(town)` 生成默认名称与分组；`getTownAtlas(town)` 返回独立命名副本，没有 atlas 的旧 JSON 可直接使用，且不会自动修改原始数据。`renameTown(town, 'city' | regionId, name)` 返回带新名称的地图，几何保持不变；`normalizeMapName` 将名称规范化为 NFC、清理首尾空白并校验 1–64 个字符，支持中英文，拒绝控制字符和换行。序列化会校验名称及区域成员，JSON 保留自定义地名。

`estimatePopulation(town, options?)` 校验地图后，根据城区用地面积估算常住人口，返回独立的 `PopulationEstimate`。`total` 和 `city` 均只覆盖城区，含人数、低高情景、建筑数、建筑占地 `footprintAreaM2` 和城区用地 `urbanAreaM2`。城郊 `outskirts` 保留建筑统计，人数为 `null`（未估算）；地块 `districts` 和命名区域 `regions` 保存分配结果。它不修改地图、不消耗随机数，不改变生成算法或 JSON 格式；没有 atlas 的旧地图使用默认命名分组。

```ts
import { estimatePopulation } from '@settlement/core';

const population = estimatePopulation(restored, {
  density: 'typical', // sparse / typical / dense：50 / 100 / 200 人/公顷
  metersPerUnit: 1, // 正数，默认 1 地图单位 = 1 米
});
console.log(population.total.residents, population.regions);
```

总人数为 `round(城区地块面积合计 × metersPerUnit² / 10_000 × 人/公顷)`。只统计 `withinCity` 地块，不用城墙或世界边界面积；当前生成地图的河海已从地块裁去，面积包含地块内道路、院落、市场、公园。以此近似已居住城市用地，不代表经历史校准的城市范围。低、高情景固定按 50、200 人/公顷计算并四舍五入，不随当前选中的情景再次放大。

密度参考 [Eltjo Buringh (2021), *The Population of European Cities from 700 to 2000*, p. 8](https://researchdatajournal.org/article/download/24674/25863/63436)：以 57 座欧洲中世纪城市校准，采用 100 人/公顷的面积代理值，讨论约 50–200 人/公顷的差异。本模型据此设定情景，而非声称该区间是置信区间或适用于所有城市、时代和小村落的实际人口界限。`POPULATION_DENSITIES` 导出这三个密度，`POPULATION_SOURCE` 导出来源；`sources` 和 `assumptions` 在每次返回时提供独立副本。

城区总人数按非市场、非公园的城区建筑占地比例分配至地块，再汇总到命名区域。此分配方式是实现假设，不是文献中的街区密度；不区分贫富人均面积，不假定楼层或入住率。低情景先用最大余数法分配，再依次分配基准、高情景的增量，保证每个地块的情景有序且人数之和等于城区总数。没有可分配建筑时，总人口仍按城区用地估算，`unallocated` 保存未能定位到区域的人数；区域人数之和加 `unallocated` 等于总数。城郊人数为 `null`，不能当零计入所谓全图总人口。

人口模型版本改为 `modelVersion: '2'`，独立于地图版本。移除旧模型的 `occupancy`、`POPULATION_PROFILES`、`PopulationProfile`、`residentialFloorAreaM2`、`densityMultiplier` 和 `rangeFraction`；未知参数（包括旧 `occupancy`）及超出数值精度的结果抛出 `RangeError`，非法地图沿用 `TownDataError`。人口报告保存方法、密度、尺度、面积口径、分配假设、局限和文献。导入 JSON 保持原地图不变；旧版未裁切河道的地块面积可能含水面，报告会额外提示该限制。

`serializeTown` 先验证再按固定字段键序输出 JSON，不舍入坐标；`deserializeTown` 只接受数据格式 `1`，验证数量、有限坐标、正面积环、所有引用、城门关系和 bounds；失败抛出带 `INVALID_TOWN_DATA` 代码的 `TownDataError`。`validateTown(unknown)` 可单独验证。导入上限为 6400 万字符、25 万顶点、每类 10 万建筑/特征、4096 地块、单环 4096 个引用，总引用数 200 万；不支持多边形洞。

P4 使用 Dijkstra 在平滑前的拓扑图上寻找最短路径，等价路径按稳定节点 ID 决定；保留原首顶点距离行为。新版本会改变部分种子的输出，旧版地图请导入 JSON。生成道路保存旧版开放路径的顺序，两种道路宽度均为 2；只有一个顶点的零段路径不导出为道路，入口仍保留。普通小巷通过建筑留白表达。

复现保证限于相同算法版本、相同规范化输入和相同 JS 运行环境。Node 24 与 Chrome 153 的三角函数有末位差异，部分等长边的切割选择会不同；跨环境需要保持同一张地图时请传递 JSON。旧 FIFO 仅在仓库测试工具中保留以复核 P2 基线，不属于当前公开 API。P4 的 620 组报告、错误与消费验证见仓库 `docs/P4_ACCEPTANCE.zh-CN.md`。

独立使用时先在仓库运行 `npm run build:packages`，再运行 `npm pack --workspace @settlement/core --pack-destination artifacts/p4`（先创建输出目录）。在其他项目用 `npm install /path/to/settlement-core-0.4.0.tgz` 安装。包只包含 ESM、声明、文档和许可证，无运行时依赖。完整验证及 Node Worker 示例见仓库 `examples/README.md`。
