# 规划驱动的三维样片

## 2026-10-28 河口与港口组合

单条河流与四向海岸已接入同一条三维流水线。源海面保持原边界，河面在入海交点裁去与海面重叠的部分，两岸陆地、自然岸坡、海岸护岸与木平桥共同装配。海岸护岸避开河口，保留码头通行、港区仓储与船舱排水规则；港口可关闭，河流与海岸仍保持连接。

```powershell
npm run sample:3d -- --seed 7 --size 12 --coast east --river true --harbor true --walls true --castle false --plaza true --output artifacts/3d-estuary-town --name scene --resolution 3200
node tests/three-d/estuary-web.mjs --reuse-sample --port 5175
```

独立报告 `verification.json.estuary` 检查河、海源区域的联合覆盖、实际水面无重叠、干地不压水及河口无阻挡；`river` 和 `harbor` 报告继续检查桥梁、两岸、码头与船只。河口几何、验证脚本与两套素材清单参与缓存和恢复检查，缺少当前组合水域版本的旧场景会从同一源规划重建。

## 2026-10-28 内陆单河与木平桥

内陆单河已接入与网页共用的三维流程：使用源 `river.surface` 生成水面和两岸河槽，保留原桥位、桥宽及关联道路，装配木平桥、梁架、支桩、石桥台与桥栏。自然岸和石砌收口服从可用干地，不改变建筑占地；桥头保持原道路标高与净通行范围。保存场景后独立读取实际网格，验证水陆分离、桥面覆盖、两岸连接和支承，再渲染样片。

新增的 7 项资源及重建说明见 [river-assets.md](river-assets.md)，可编辑库、GLB、纹理、预览与独立回读报告位于 `artifacts/river-assets/`。

```powershell
npm run sample:3d -- --seed 7 --size 12 --coast false --river true --walls true --castle false --plaza true --preview --output artifacts/3d-river-town --name scene
# 导入原规划，保留已有布局：
npm run sample:3d -- --input artifacts/3d-river-town/source-town.json --preview --output artifacts/river-import --name scene
```

样片输出包括 `scene.blend`、`city-center-render.png`、`planning.png/svg`、`source-town.json`、`selection.json`、`scene-manifest.json` 与含 `river` 结果的 `verification.json`。水面为静态淡彩，采用木平桥；石拱桥、通航净空及内河码头后续扩展。旧河流 JSON 缺少实际 `surface` 时保留二维导入，并给出明确的三维能力提示。

网页验收脚本为 `node tests/three-d/river-web.mjs`，支持 `--base`、`--port`、`--input`、`--output`。未传 `--base` 时自行启动临时开发服务，默认使用独立端口 5175，任务保存到独立目录，结束后关闭服务。使用 `--reuse-sample` 会在独立任务目录预置已验证样片，实际提交规划并检查 202、缓存复用、结构报告、原规划一致及图片/场景下载，不启动额外渲染。

## 2026-10-27 沿海港城

海水、石砌护岸、木码头、仓库构件及划艇/渔船/商用帆船已制作为 [12 个可编辑模块与独立 GLB](../../artifacts/harbor-assets/README.md)，并接入网页和命令行共用的三维装配流程。水面与岸线使用原规划多边形；码头路径、宽度、道路连接及港区建筑占地不变。护岸细节、仓库立面选择及船只泊位属于可追溯的三维设计规则。默认沿海城内取景包含码头、船只和墙外港区。

2026-10-28 补齐直接命令行配置与旧任务恢复入口：`sample:3d` 可直接使用 `--coast east --harbor true` 等规划参数。旧场景重试会核对当前素材库及港口机器清单哈希；已过期时保留源规划并重新装配，一致时继续复用保存场景。两条路径均执行船舱干燥校验。

素材、重建命令与验证说明见 [harbor-assets.md](harbor-assets.md)。[港城样片](../../artifacts/3d-harbor/README.md)包含平面规划、三维场景、全景/城内图和实际几何校验报告。支持东南西北海岸、港口关闭以及与现有城堡/城墙组合；河口与海岸组合也已接入，多个市场也可分别装配和校验。

## 2026-10-27 管线性能优化

网页与命令行默认只生成城内图，全景与城堡图按需渲染。网页选择其他取景会复用该规划的校验场景；重复生成相同质量及取景会直接复用已完成图片。输入、几何代码、素材库、校验器、渲染器和文件哈希分别参与缓存校验，渲染质量和图片尺寸也必须匹配。场景或校验报告被改写、素材/代码变化、图片损坏时会失效，缓存不会放宽任何几何检查。

原生建筑、城墙和素材在脱离场景的集合中装配后统一挂载；顶点变换只计算一次，已完全包含的部件跳过无效裁切，仍保留原图元与 UV。市场、树木、店面占用物以及独立校验使用空间索引筛选附近对象，再运行原有精确判断。底色、线稿与遮挡层使用临时场景，预先记录遮挡索引，避免逐次改写数万对象的显示状态。没有删减建筑、装饰、材质或高清采样。

`pipeline-performance.json` 记录实际子进程耗时；`build-timing.json`、`render-timing.json` 和每张图片的 `*.render.json` 进一步记录构建与渲染阶段。完整的等输出对比报告保存在 `artifacts/3d-performance/report.html` 及 `report.json`，报告区分历史时间线估算、当前进程实测与缓存命中，不混用性能分析器附加耗时。

```powershell
# 默认只渲染城内图；预览仍保留完整模型
npm run sample:3d -- --input town.json --name scene --preview
# 明确生成全景、城内与城堡的全套图片
npm run sample:3d -- --input town.json --name scene --details
# 复用有有效缓存签名的校验场景，换取景或质量
npm run sample:3d -- --input town.json --name scene --reuse-scene artifacts/web-3d/<任务ID> --view full
```

新输出的图片统一命名为 `city-center-render.png`、`scene-render.png`、`castle-wall-detail.png`；旧样片文件继续作为历史产物保留。`--reuse-scene` 要求完全一致的规划及有效场景签名，旧的失败场景仍用下文的 `--recover-scene` 修复路径。开发回归服务器使用单独任务目录，避免干扰用户正在运行的任务。

算法 0.14.0 的新教堂在二维规划阶段生成矩形主殿、方形钟楼和可选短翼，地块边界可以是三角形或不规则多边形。`architecturalRole` 随规划和适配器传入 Blender，直接决定主屋顶、钟楼上部和附楼素材的安装位置；不再根据狭长体量猜测钟楼。复用现有素材库，不增加或改写美术资源。独立校验同时检查源角色、矩形直角、最小宽度及钟楼正方形占地。旧 JSON 和旧场景保留原几何，并继续使用旧角色推断；重新生成地图后应用新布局。

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

管线会先构建已有 packages，再导出平面图、装配并保存三维场景，独立结构与素材校验通过后才渲染。可用 `--preview` 快速预览，`--resolution 3200` 设正式图分辨率，`--skip-build` 跳过已完成的包构建。Blender 可通过 `--blender` 或 `BLENDER_PATH` 指定；Windows 默认使用本机 Blender 5.2 安装路径。所有命令都不打开或修改用户正在编辑的 Blender 场景。

大城市使用建筑及道路包围盒空间索引进行候选检索，避免每个门窗、木构件都遍历全城；精确碰撞判断保持不变。启用素材库时不再创建随后会被素材替换的临时木构、门窗和屋脊网格，但保留同一随机决策序列和建筑设计记录；原生墙壳、屋面及保留部件仍照常生成。屋顶按双精度规划边界裁切，凹多边形三角剖分保留原始双精度坐标，最终网格仍按严格占地限制检查。细长占地的质心校验额外记录其实际 float32 表示误差，边界和面积误差限制不放宽。

若网页任务已保存 `.blend`，但在校验或渲染阶段失败，可在历史结果中选择「复用已保存场景重试」。该操作新建恢复任务，保留原始失败记录和规划快照，修复越界裁切屋顶后重新独立校验，通过才继续渲染。不会重新生成或删除建筑。命令行可使用 `--recover-scene artifacts/web-3d/<原任务ID>`，必须同时提供与旧场景完全一致的 `--input` 规划。仅有输入、尚未保存场景的任务需要正常重新生成。

三维适配覆盖内陆与沿海地形、内陆单河和木平桥、河口与海岸组合、港口、普通建筑、城墙、多个市场及 grove/statue/fountain；各市场按来源 ID 记录占地、陈设与人物，并检查跨市场避让。现有核心生成器不做修改。直接生成和 JSON 导入的源 JSON、平面 SVG/PNG 已验证逐字节一致。

## 下一档：小镇 size=12

城堡开启时，内部围墙也按源规划生成。算法 0.13.0 已在二维阶段写入实际门洞：城市门宽 8–20m，城堡门宽 6–12m，相邻城市门之间保留至少 8m 实墙；道路穿门处转为接近法向，并与门面保持至少 75° 夹角。三维直接复用门洞端点，门楼和附属件随同一门面定向。旧 JSON 中仍只有显式入口点的城堡继续使用兼容开洞逻辑。塔楼半径按距入口的距离限制，避免封住入口。城堡使用新增的石砌主堡、低坡屋顶、垛口和四角塔楼素材；专用城堡门楼、墙顶通道与附属房舍套件仍待补充。

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

平面道路覆盖检查读取实际保存网格的三角面，用双精度 XY 距离判断源节点和线段中点是否落在铺装上；高度、面朝向、源宽度和重叠面分别检查。避免 Blender BVH 最近点计算在细长三角面上引入额外单精度误差，原有位置阈值保持不变。每条道路的 `checks` 与 `coverage` 记录具体检查项、最大距离及失败采样点；该计算模块只使校验缓存失效，可复用已有场景。

裁切只沿街区边界取出完整建筑，并增加东南侧原有空地以纳入城墙。道路和墙使用精确线段/裁切多边形相交。墙是开放链：`closed:false`，`activeSegments.length=points.length-1`；不能把末尾自动接回起点。

2026-10-23 使用 Blender 5.2.1 LTS 对保存后的场景执行独立验证，结果为 **PASS**：35/35 栋原建筑、22 条裁切道路、8 段有效城墙、两个原城门中心以及原市场轮廓均通过。还原到规划坐标后的最大建筑边界误差为 `7.04 × 10^-6` 规划单位，小于 `1 × 10^-4` 阈值；无建筑挪位或占地改形。完整逐栋误差及源文件哈希见 `verification.json`。若随后重建场景，应再运行验证，以报告中的文件哈希为准。

## 样片边界

- 这是规划驱动的三维拼装样片，平面结构可核验；层数、屋顶和立面属于生成设计。
- 第一版以贴合轮廓的双坡顶为主，第二版增加多种坡顶及分段体量；复杂轮廓尚未覆盖完整的中世纪屋顶做法。相邻建筑共墙、精确门位和导航可通行性也未做完整建筑学求解。
- 门窗、木梁、屋檐及烟囱是组合构件，可能轻微伸出保留的主墙体占地。整体比照的是主墙落地边界。
- 原规划的广场 feature 与渲染中的市场陈设应区分：额外摊位、人物和货物只增加场景生活感，不属于原始规划建筑数。
- 风格以正交轴测、细轮廓线、低饱和淡彩和重复砖瓦纹理实现。线条仍带规则的计算机生成特征，与参考图的手绘排线及自由笔触存在差距。
- 当前验证不等于逐个细部无穿插，也不是完整路径导航、性能基准或可直接投入游戏的资产验收。
