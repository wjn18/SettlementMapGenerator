# 规划驱动的三维样片

小镇素材已接入：新增 [61 个可编辑模块与独立 GLB](../../artifacts/small-town-assets/README.md)，覆盖小镇机器清单全部 11 类 P0/P1；网页和命令行现在默认使用素材库。[新素材小镇整城结果](../../artifacts/3d-small-town-assets/README.md)保留原 299 栋建筑、道路与墙线，附使用清单、实际几何验证、教堂和市场局部图。原样片作为历史对照保留。详见 [小镇素材文档](small-town-assets.md)。

`render_sample_v2.py` 默认从 `artifacts/small-town-assets/small-town-asset-library.blend` 加载 Collection。`--asset-library` 可指定另一份符合清单的库，`--legacy-assets` 可使用程序组件做对照。`asset_integration.py` 负责角色、轮廓适配与避让，`verify_integrated_assets.py` 独立检查保存后的组件，`render_pipeline.py` 输出原生淡彩、结构线及可见遮挡；渲染助手也内嵌在新 `.blend` 文件中。

素材缺口补充：[城堡主堡、门楼及相关组件](castle-assets.md)（[机器清单](castle-asset-gap-list.json)）。

## 最小完整城市：平面图 → 3D

新增端到端入口，直接复用现有 `generateTown → TownData → buildMapScene → createSVGRenderer` 平面图流程，再将同一份 TownData 的原始实体交给 Blender 拼装。也可以读取平面图界面导出的 JSON；不需要识别或重画 PNG。网页已接入同一管线：启动 `npm run dev`，左侧「三维场景」可提交当前规划，查看进度、取消、历史预览及下载。网页任务独立保存于 `artifacts/web-3d/`，不会覆盖以下样片。

```powershell
npm run sample:3d -- --seed 7 --size 6
# 使用平面图界面导出的规划数据：
npm run sample:3d -- --input path/to/exported-town.json --output artifacts/my-city
```

`size=6` 是现有生成器支持的最小档，不表示 6 栋建筑。默认种子 7、城墙/广场开启、城堡关闭，本次完整规划有 **107 栋建筑、44 条道路、5 个城门、12 个塔楼定位点、4 片树丛和 1 座雕像**。所有源实体完整保留，城墙按原始闭环处理，没有沿用旧样片的 L 形裁切。默认输出至 `artifacts/3d-minimal-city/`：

- `planning.svg` / `planning.png`：现有平面图渲染器直接导出。
- `source-town.json` / `selection.json`：完整源规划及三维适配数据，含原始 ID 和坐标。
- `minimal-city-render.png` / `minimal-city.blend`：全城三维图及可编辑场景。
- `city-center-render.png`：同一场景的城内放大取景；城外农舍仍保留在全景与场景中，补图不重新保存场景。
- `adapter-verification.json` / `verification.json`：数据完整性、实际三维占地、道路、墙段、门口及规划要素验证。
- `asset-gap-list.json`：本次素材清单；中文说明见 [minimal-assets.md](minimal-assets.md)。

原始 Farm/Park 地块以浅色地表表达；4 处 grove 保留源多边形，树木为带源 ID 的程序占位。农用建筑降低至一至二层，但仍缺专用农舍/仓棚构件；富裕住宅也仍用通用房屋模块。没有凭空新增田块、作物或水系。原规划只约束平面，楼层/屋顶/店铺是设计解释。

管线会先构建已有 packages，再导出平面图、渲染三维并执行结构验证。可用 `--preview` 快速预览，`--resolution 3200` 设正式图分辨率，`--skip-build` 跳过已完成的包构建。Blender 可通过 `--blender` 或 `BLENDER_PATH` 指定；Windows 默认使用本机 Blender 5.2 安装路径。所有命令都不打开或修改用户正在编辑的 Blender 场景。

三维适配覆盖无水地形、普通建筑、城墙、单个市场、grove/statue/fountain；水系与多个市场尚未实现，管线会明确停止而非静默漏画。现有核心生成器不做修改。直接生成和 JSON 导入的源 JSON、平面 SVG/PNG 已验证逐字节一致。

## 下一档：小镇 size=12

城堡开启时，内部围墙也按源规划生成。城堡门口可能以显式入口点标记、相邻墙段仍为 active；三维在这些墙段上方保留过梁、下方留出通道，并按距入口的距离限制塔楼半径，避免实墙和塔楼封住入口。普通城墙的 inactive 缺口保持不变。城堡主体目前仍采用通用建筑占位，专用主堡、门楼等素材尚待补充；这不应阻断结构生成。

沿用 seed=7、城墙与广场开启、城堡关闭，选择界面中比“村落 size=6”大一级的“小镇 size=12”。独立输出，不覆盖上一档：

```powershell
npm run sample:3d -- --size 12 --seed 7 --output artifacts/3d-small-town --name small-town --resolution 3600
```

本次原规划包含 299 栋建筑、69 条道路、6 个城门、16 个塔楼定位点、31 段有效城墙、2 片树丛与 1 座喷泉。与上次 107 栋相比约为 2.79 倍；改变规模会重新生成布局，不是将旧城市等比例放大。

喷泉保留原始 16 边占地，新增池壁、水面和喷柱程序占位；市场与店面预留喷泉范围，不再追加水井。教堂街区 d10 有 10 个建筑轮廓，当前仍用通用房屋表现，专用教堂及附属建筑构件列为新增素材缺口，不应把这 10 个轮廓解释为 10 座教堂。

输出包括 `small-town-render.png`、`city-center-render.png`、`small-town.blend`、`planning.png/svg` 及验证报告；`scale-comparison.json` 记录两档计数，`asset-gap-list.json` 记录本次缺口。中文说明见 [small-town-assets.md](small-town-assets.md)。

## 35 栋建筑的城墙市场街区样片

本实验直接使用当前 `@settlement/core` 的规划结果生成可编辑 Blender 场景。选区由商人街区 `d14`（11 栋）、工匠街区 `d36`（24 栋）和市场 `d37` 组成，保留其原始建筑轮廓、道路、市场和附近城墙。选区为自然街区形成的 L 形，未为了构图改成完整四面城墙。

## 第二版：建筑差异与插画细化

第二版保存在 `../../artifacts/3d-sample/v2/`，第一版图像与场景继续保留。复用同一份 `selection.json` 和 `source-town.json`，沿用 0.5 的统一水平映射。

- 35 栋中，24 栋为二层、8 栋为三层、3 栋为一层，层高有所变化。
- 使用不对称双坡、四坡、半四坡、折线坡和低单坡；长屋在原占地上分为 2–3 个错落屋顶体量。竖向高差有墙面封闭。
- 四种木构节奏、不同窗组与窗板、屋顶窗和烟囱；相邻共墙处减少开窗。
- 14 个店面，含酒馆、烘焙、铁匠、布商、鞋匠、陶器、杂货和仓储配方，组合帆棚、门廊、柜台、图标招牌和灯笼。最大出挑 1.28 场景米，检查邻栋、道路中心与已有市场物件避让。
- 原 10 摊位、84 人物和原规划雕像保留。材质添加非均匀淡彩色层、颗粒、扰动砖瓦线及依表面方向变化的断续交叉排线；线条加入轻微笔触扰动。全程为可编辑三维与原生渲染，未对生成图进行会改变结构的图生图重绘。

第二版的 `market-quarter-render.png` 为 3200 × 3200 全图，`market-shop-detail.png` 为 2400 × 2000 店面局部；`market-quarter.blend` 为可编辑场景。`planning-context.png` 展示完整 107 栋规划与本次 35 栋选区，说明凹形外缘属于裁切范围。

```powershell
& $blenderExe --background --factory-startup --python-exit-code 1 --python experiments/3d-sample/render_sample_v2.py
& $blenderExe --background --factory-startup --python-exit-code 1 --python experiments/3d-sample/render_detail_v2.py
& $blenderExe --background --python-exit-code 1 --python experiments/3d-sample/verify_scene.py -- --artifact-dir artifacts/3d-sample/v2
python experiments/3d-sample/draw-context.py
```

建筑差异由 `buildings_v2.py` 控制，店面由 `shopfronts_v2.py` 控制，淡彩排线由 `illustration_v2.py` 控制。`scene-manifest.json` 保存逐栋屋顶类型、立面、店铺配方与摆放范围。结构验证仍读取最终 `.blend` 实际顶点，结果和文件哈希写入第二版 `verification.json`。

## 输入与坐标

生成参数为 `seed=7, size=6, walls=true, castle=false, plaza=true`，使用当前 core `0.11.0`。检查过仓库已有的 p5 fixtures 后，本实验选择通过现有 core 生成紧凑、市场靠墙的小镇，未修改 core 实现。

`source-town.json` 保存完整规划，`selection.json` 保存样片选区。两份文件保留原规划坐标。三维场景采用统一可逆的水平映射：

```text
scene.x = planning.x * 0.5
scene.y = planning.y * 0.5
scene.roadWidth = planning.roadWidth * 0.5
```

对应 `scene-manifest.json` 的 `horizontalScale`。建筑、广场、墙、道路及其宽度同时映射，不单独挪动或缩放建筑。选区约 254 × 259 规划单位，对应约 127 × 129 场景单位；这是样片采用的插画尺度设定，原始规划未声明实际米制测绘精度。

建筑高度、层数、屋顶、木构、门窗、砖石、塔楼体积及市场陈设为样片设计内容，不能从二维规划唯一还原。高度及人物按所选场景尺度设计，不能把本图当作真实城市的测绘三维重建。

## 文件

输出位于 `../../artifacts/3d-sample/`：

| 文件 | 用途 |
| --- | --- |
| `source-town.json` | 完整原始 TownData，可追溯所有源 ID 与坐标 |
| `selection.json` | 35 栋建筑、三个街区、原始市场、裁切路网及城墙 |
| `planning-selection.svg` / `.png` | 原始规划的二维对照图 |
| `market-quarter.blend` | 可编辑三维场景，含相机、材质、建筑和市场道具 |
| `scene-manifest.json` | 建筑 ID、楼层、屋顶、墙段、道具及坐标比例记录 |
| `render-preview.png` | 低分辨率构图和样式预览 |
| `market-quarter-render.png` | 2800 × 2800 正式线稿淡彩渲染，暖白纸色背景 |
| `verification.json` | 从最终 `.blend` 实际顶点执行的几何校验报告 |

脚本：`select-sample.mjs` 生成选区；`draw-plan.py` 绘制二维对照；`render_sample.py` 拼装三维建筑、墙体和材质；`props.py` 生成市场道具和人物；`verify_scene.py` 独立检查最终场景。

## 复现

以下命令在 `SettlementMapGenerator` 根目录执行。使用仓库已有 Node 依赖，Python 绘图需要 Pillow；三维生成与验证由 Blender 自带 Python 执行。将 `$blenderExe` 设为本机 Blender 可执行文件的实际路径。

```powershell
node experiments/3d-sample/select-sample.mjs
python experiments/3d-sample/draw-plan.py

& $blenderExe --background --factory-startup --python-exit-code 1 --python experiments/3d-sample/render_sample.py -- --preview
& $blenderExe --background --factory-startup --python-exit-code 1 --python experiments/3d-sample/render_sample.py
& $blenderExe --background --python-exit-code 1 --python experiments/3d-sample/verify_scene.py
```

先完成最终渲染/保存，再执行验证。验证脚本会自行加载 `market-quarter.blend`，不依赖 Blender 中此前打开的文件。预览和正式渲染都会重建并覆盖本实验的 `.blend` 和 manifest；改变构图或参数后应再次验证。

`render_sample.py` 支持 `--angle`、`--elevation`、`--plan-scale` 和 `--no-props`。默认 `--plan-scale 0.5`。为复现交付构图，采用交付 manifest 的 camera 数值。生成图只会写入实验输出目录，不修改现有应用或 core 代码。

## 几何校验

验证读入实际已保存的场景顶点，应用对象世界变换后除以 `horizontalScale`，逐栋比较落地轮廓与原规划。屋顶生成可以在原边上增加共线中点，因此不要求顶点个数和顺序相同。要求双向边界误差与重心误差均小于 `1e-4` 规划单位，面积差也需落在浮点计算容差内。

还检查 35 栋建筑的 ID、街区 ID、数量与源 TownData 一致；城墙实心段仅落在原 activeSegments；城门中心离地 2.1 场景单位以内未被墙体堵塞；道路实际网格的中心线与宽度符合统一映射；市场轮廓保持一致。报告中保存源 JSON、manifest 和 `.blend` 的 SHA-256，便于确认验证对应的版本。

裁切只沿街区边界取出完整建筑，并增加东南侧原有空地以纳入城墙。道路和墙使用精确线段/裁切多边形相交。墙是开放链：`closed:false`，`activeSegments.length=points.length-1`；不能把末尾自动接回起点。

2026-10-23 使用 Blender 5.2.1 LTS 对保存后的场景执行独立验证，结果为 **PASS**：35/35 栋原建筑、22 条裁切道路、8 段有效城墙、两个原城门中心以及原市场轮廓均通过。还原到规划坐标后的最大建筑边界误差为 `7.04 × 10^-6` 规划单位，小于 `1 × 10^-4` 阈值；无建筑挪位或占地改形。完整逐栋误差及源文件哈希见 `verification.json`。若随后重建场景，应再运行验证，以报告中的文件哈希为准。

## 样片边界

- 这是规划驱动的三维拼装样片，平面结构可核验；层数、屋顶和立面属于生成设计。
- 第一版以贴合轮廓的双坡顶为主，第二版增加多种坡顶及分段体量；复杂轮廓尚未覆盖完整的中世纪屋顶做法。相邻建筑共墙、精确门位和导航可通行性也未做完整建筑学求解。
- 门窗、木梁、屋檐及烟囱是组合构件，可能轻微伸出保留的主墙体占地。整体比照的是主墙落地边界。
- 原规划的广场 feature 与渲染中的市场陈设应区分：额外摊位、人物和货物只增加场景生活感，不属于原始规划建筑数。
- 风格以正交轴测、细轮廓线、低饱和淡彩和重复砖瓦纹理实现。线条仍带规则的计算机生成特征，与参考图的手绘排线及自由笔触存在差距。
- 当前验证不等于逐个细部无穿插，也不是完整路径导航、性能基准或可直接投入游戏的资产验收。
