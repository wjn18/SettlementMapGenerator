# API 与数据接口草案

P2 已实现本文生成入口和 TownData 数据格式 `1`，实际导出类型见 `packages/core/src/types.ts`，用法与验证规则见 [core 使用说明](../packages/core/README.md)。P3 已实现下述绘制接口，见 [map-scene](../packages/map-scene/README.md) 与 [renderer-openfl](../packages/renderer-openfl/README.md)。算法版本仍为 `0.2.0-legacy`，尚未发布 npm 包。

## 生成入口

```ts
type FeatureChoice = boolean | "auto";

interface GenerateOptions {
  seed: number;            // 必填整数，范围 1..2147483646
  size: number;            // 初版整数范围 6..40，指城区基础地块规模
  walls?: FeatureChoice;  // 默认 auto
  castle?: FeatureChoice; // 默认 auto
  plaza?: FeatureChoice;  // 默认 auto
  maxAttempts?: number;   // 默认 20，允许 1..100
}

interface GenerationError {
  code: "INVALID_OPTIONS" | "GENERATION_FAILED" | "RESOURCE_LIMIT";
  stage: string;
  message: string;
  attempts: number;
}

type GenerationResult =
  | { ok: true; town: TownData }
  | { ok: false; error: GenerationError };

declare function generateTown(options: GenerateOptions): GenerationResult;
```

`auto` 使用本次生成的实例随机数解析为布尔值。输出 request 补齐默认值，resolved 保留实际解析值。算法始终按 plaza、castle、walls 的顺序消耗三次随机数，再应用显式开关；后续重试继续使用本次局部随机流。此策略随算法版本固定。`generateTownSteps` 另提供可交错推进的阶段迭代器。

范围外参数返回错误，不默默钳制。JSON 导入先做结构、有限数值、数量上限、引用和版本校验。程序缺陷不统一包装成可重试几何错误。

## 地图数据

所有 ID 为单张地图内的稳定字符串，不是全局唯一标识。坐标采用 x 向右、y 向下的世界坐标；不用像素或屏幕分辨率作为地图单位。

```ts
type Id = string;
type PolygonRing = Id[]; // 引用 vertices；至少三个顶点，不重复末尾起点

interface Vertex { id: Id; x: number; y: number }
interface Point2 { x: number; y: number }
interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

interface District {
  id: Id;
  boundary: PolygonRing;
  wardType: string; // 注册表中的稳定标识，不依赖构造函数名称
  withinCity: boolean;
  withinWalls: boolean;
}

interface Building { id: Id; districtId: Id; boundary: PolygonRing }
interface Feature {
  id: Id;
  districtId: Id;
  kind: "grove" | "statue" | "fountain";
  boundary: PolygonRing;
}
interface Road {
  id: Id;
  kind: "street" | "external";
  vertexIds: Id[]; // 开放折线，按通行方向排列
  width: number;  // 世界单位
}
interface Wall {
  id: Id;
  kind: "city" | "castle";
  boundary: PolygonRing;
  activeSegments: boolean[]; // 与 boundary 等长，标记 i 到 (i+1)%n 的边
  gateIds: Id[];
  towerVertexIds: Id[];
}
interface Gate { id: Id; wallId: Id; vertexId: Id }

interface TownData {
  schemaVersion: "1";
  generatorVersion: string;
  request: Required<GenerateOptions>;
  resolved: {
    seed: number;
    size: number;
    walls: boolean;
    castle: boolean;
    plaza: boolean;
    attempts: number;
  };
  vertices: Vertex[];
  districts: District[];
  buildings: Building[];
  features: Feature[];
  roads: Road[];
  walls: Wall[];
  gates: Gate[];
  entrances: Id[]; // 所有城镇入口顶点；无实体城墙时也可能存在
  center: Point2;
  bounds: Bounds;
}
```

原 `Ward.geometry` 同时容纳建筑、绿地、雕像等轮廓，导出时按语义区分，不能全部解释成房屋。`roads` 保存主街 / 外部道路；普通街巷在初版仍可由建筑和地块留白表达，不声称已经拥有完整可通行的小巷中心线图。

初版多边形不支持洞；若以后水域、庭院等要求带洞多边形，必须显式扩展协议。规范化输出采用固定字段与实体排序、统一顶点绕序，首期不为了减小文件而擅自舍入计算坐标。

导出的地图是与内部可变结构分离的数据快照。调用者修改返回数据不会改变后续生成；绘制器视其为只读。

P2 已实现 `serializeTown`、`deserializeTown`、`validateTown`，JSON 导入失败抛出 `TownDataError`。`createVertexIndex` 将共享 ID 解析到同一顶点；`hasVertexId` 与 `containsPoint` 分别表示拓扑成员关系和几何包含。单点零段路径不作为 Road 导出，城门入口仍保留。固定种子复现范围为同算法版本、同 JS 运行环境；跨环境保持同一地图请传 JSON，详见 [P2 浮点差异记录](P2_ACCEPTANCE.zh-CN.md)。

## 绘制接口

以下为 P3 已实现的公共边界。MapScene 包不接触 DOM；只有 OpenFL 绘制包的挂载接口接触 DOM。

```ts
interface Stroke {
  color: string;
  width: number;
  units: "world" | "screen";
  cap: "butt" | "round" | "square";
  join: "miter" | "round" | "bevel";
  miterLimit: number;
}

type DrawCommand =
  | { kind: "polygon"; points: Point2[]; fill?: string; stroke?: Stroke }
  | { kind: "polyline"; points: Point2[]; stroke: Stroke }
  | { kind: "circle"; center: Point2; radius: number; fill?: string; stroke?: Stroke };

interface MapTheme {
  paper: string;
  light: string;
  medium: string;
  dark: string;
  normalStroke: number;
  thickStroke: number;
}

interface MapScene {
  bounds: Bounds;
  background: string;
  commands: DrawCommand[]; // 严格按数组顺序绘制
  hitRegions: { entityId: Id; points: Point2[] }[];
}

interface Viewport {
  centerX: number;
  centerY: number;
  zoom: number; // CSS 像素 / 世界单位；DPR 由适配器单独处理
}

interface MapRenderer {
  render(scene: MapScene): void;
  setViewport(viewport: Viewport): void;
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  pick(cssX: number, cssY: number): Id | null;
  dispose(): void;
}

declare function buildMapScene(town: TownData, theme: MapTheme): MapScene;
declare function createOpenFLRenderer(container: HTMLElement): MapRenderer;
```

地图绘制与提示文本分离：`pick()` 返回实体 ID，由预览应用查找标签。需要独立文字图层时再补字体和文字布局协议，避免让算法库依赖 DOM 或 OpenFL 字体对象。

渲染不改变地图；切换 OpenFL / SVG / Canvas 时重复使用同一 `MapScene`。渲染失败与生成失败分别报告。`dispose()` 后释放适配器事件与资源，重复销毁应安全。

## 对外承诺

- 第一版以 JS / TypeScript 调用和 JSON 交换为主要消费方式。
- 不承诺其他原生语言可以直接加载 TypeScript 包。
- 数据格式迁移与算法种子兼容分别管理；旧版格式不受支持时明确报错。
- 预览页面先承担按钮、URL 状态和文件导入导出，保持库接口聚焦。
