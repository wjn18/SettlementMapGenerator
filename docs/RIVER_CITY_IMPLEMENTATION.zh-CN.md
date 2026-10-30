# 内陆单河三维生成交付

已接通内陆单河、木平桥和两岸的三维生成。网页、命令行和规划 JSON 导入使用同一份源规划；河面、桥位、道路净宽、建筑占地及城墙有效段保持来源一致。网页历史结果新增“穿城河样片”。

## 实现内容

`river_geometry.py` 从实际 `river.surface` 分离两岸，按道路、建筑、公共要素和城墙的可用间距划出自然岸坡，空间不足处保留竖直岸壁。平地扣除岸坡带，河床低于水位，岸坡具有封闭底盖，相邻单元共用顶点并删除内部重复面。

`river_integration.py` 和 `bridge_integration.py` 装配实际水面、河床、两岸、桥面、梁架、支桩、桥台与桥栏。桥路继续保留原道路 ID、路径、净宽和高度，并使用木板材质；桥台跨在源桥端点两侧，与桥面具有实际承接面积。所有构件服从同一 `horizontalScale`，源 `TownData` 不增加字段。

共享能力检查用于网页、服务端和 CLI。场景、验证和渲染分别使用依赖指纹；河流素材库及清单参与场景和恢复检查。河口与海岸组合现已扩展支持，见[河口定居点三维生成交付](ESTUARY_CITY_IMPLEMENTATION.zh-CN.md)。缺失实际河面的旧 JSON、桥侧余量不足的规划会明确提示。

内陆适配支持核心生成器输出的横贯矩形范围的单条 x 单调河流，河口适配另支持四向海岸及港口开关。石拱桥、内河码头、支流、岛屿和通航高程留待后续。

## 资源

`artifacts/river-assets/` 已交付 7 项原生三维资源：自然岸剖面、护岸收口、木桥面与梁架、桥桩斜撑、石桥台、桥栏和栏杆端柱。包括可编辑库、7 个 GLB、纹理、预览、机器清单、独立回读验证及 ZIP。

资源库 SHA-256 为 `cfe9d2b2c376b5f5a9057ec7a227195ca1f6be1882ffafebb48358bea4065461`。7 个 GLB 独立回读全部通过，尺寸边界最大误差为 0。详细接口见 `experiments/3d-sample/river-assets.md`。

## 样片

主样片位于 `artifacts/3d-river-town/`。参数为 seed 7、size 12、river true、walls true、castle false、plaza true。

| 产物 | 内容 |
| --- | --- |
| `city-center-render.png` | 3200 × 3200 线稿淡彩成图 |
| `scene.blend` | 可编辑的完整三维场景 |
| `source-town.json`、`selection.json` | 原规划与逐实体适配数据 |
| `planning.png`、`planning.svg` | 同一规划的二维对照 |
| `verification.json` | 独立读取已保存场景的结构及素材报告 |
| `river-tamper-verification.json` | 对最终场景的七项破坏测试 |
| `asset-integration.json` | 实际素材使用清单 |
| `pipeline-performance.json` | 完整导出、装配、校验及渲染耗时 |

最终结构为 PASS：225 栋建筑、97 条道路、36 段有效墙体、6 个城门、3 个公共要素和 1 座木桥。两岸裸边及异常边均为 0，两座桥台的落床与承接检查通过。教堂已按算法 0.15.1 转为沿地块长轴布置，仅主殿、钟楼与两翼的占地改变，其余实体保持一致。结构与破坏报告对应的最终场景 SHA-256 为 `9dc86bd2ab1f2de5e07955beef064496977837bd0ef3731764b9cb18f87871d7`。

无墙回归样本位于 `artifacts/river-tests/unwalled/`，使用最终生成器重建后通过相同结构校验：seed 42、size 6、72 栋建筑、84 条道路和 1 座桥。

## 验证

- 纯 Python 几何单测 7 项通过；12 张不同种子和规模的实际规划通过面积分区与三角化检查。
- 河流能力、缓存、恢复与 CLI 参数测试共 46 项通过。
- 原二维河流与地形回归 40 项通过。
- 七项实际网格破坏全部正确拒绝：缩桥、移动桥头、抬高水位、地板盖河、堵桥头、删除岸坡底盖、移开桥台。
- 算法包与网页构建通过。
- `river-web.mjs --reuse-sample --port 5175` 通过：浏览器提交 202、结果缓存命中、3200 像素图片显示、源规划一致及图片和场景下载；临时服务结束后关闭。截图与报告位于 `artifacts/river-web-test/`。

## 全规模回归

`artifacts/river-all-sizes/` 提供界面全部 7 个预设规模的内陆河与河口港城，共 14 份完整场景、原规划、二维对照、成图和结构报告。每例使用 seed 7；内陆组启用城墙、城堡和市场，河口组为 east 海岸、港口与无墙无城堡组合。场景保留原建筑、道路、地块和实际桥梁 ID，没有通过改变规划开关绕开失败项。

| 规模 | 内陆建筑 | 内陆桥梁 | 河口建筑 | 河口桥梁 | 河口码头 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 6 | 142 | 1 | 68 | 1 | 4 |
| 12 | 436 | 1 | 164 | 1 | 3 |
| 24 | 638 | 1 | 440 | 1 | 4 |
| 40 | 863 | 2 | 712 | 1 | 8 |
| 60 | 1485 | 1 | 1037 | 1 | 6 |
| 80 | 1881 | 2 | 1416 | 1 | 3 |
| 100 | 2462 | 2 | 1668 | 1 | 5 |

样片目录按 `inland-<size>`、`estuary-<size>` 命名，普通成图为 1500 像素，最大内陆和河口成图为 3200 像素。完整入口为 `index.html`，机器清单为 `delivery.json`，矩阵汇总为 `report.json`，独立审计为 `independent-audit.json`。每例的 `verification.json` 对应同目录实际场景及来源文件的 SHA-256。

本轮发现并修复了 24 档内陆城 `r168` 的真实路面裂缝：一个缩放后长 `0.0009528078` 的非零源段被旧的 `.001` 长度门槛跳过。路面构造和角点核对现仅跳过零长度段，保持原道路 ID、坐标、宽度及原 `5e-5` 场景单位覆盖容差。144 个 float32 回读密集采样的最大偏差从 `0.0004712209` 降到 `0.0000016573`；完整 Blender 回读也通过。修复前报告和复现数据保存在 `issues/short-road-segment/`。

恢复旧场景时，如果源道路含此类短非零段，必须有对应路面的实际覆盖、坐标检查以及四份来源/场景文件的匹配哈希，才能保留旧几何；缺少证据时按原规划重建。无短段场景继续按原恢复规则处理。

全规模验收还包括 70 组两种子、内陆及四向河口的水陆分区/三角化预检，以及 API 范围 6–100 每个整数 × 两种地形的 190 组核心、能力与序列化检查。它们与 14 份实际三维场景分开记录。最大内陆城的两座桥分别运行 7 项真实网格破坏测试，最大河口城另运行 7 项；最终画廊检查全部图片、下载链接和浏览器错误。

## 复现

以下命令在 `SettlementMapGenerator/` 运行。Blender 使用已有默认路径，或通过 `BLENDER_PATH` 指定。

```powershell
# 使用已交付源规划，保留同一布局。
npm run sample:3d -- --input artifacts/3d-river-town/source-town.json --output artifacts/river-reproduction --name scene --resolution 3200

# 从种子生成内陆河城市。
npm run sample:3d -- --seed 7 --size 12 --river true --walls true --castle false --plaza true --output artifacts/river-from-seed --name scene --preview

python tests/three-d/test_river_geometry.py
node --test tests/three-d/river-support.test.mjs tests/three-d/recovery-assets.test.mjs tests/three-d/cache.test.mjs tests/three-d/options.test.mjs
node tests/three-d/river-web.mjs --reuse-sample --port 5175

# 全规模真实场景、结构校验与预览图，可按 --case inland-24 定位重跑。
node tests/three-d/river-all-sizes.mjs
node tests/three-d/river-all-sizes.mjs --summary-only
python tests/three-d/audit_river_all_sizes.py --require-tamper
node scripts/report-river-all-sizes.mjs
node tests/three-d/river-all-sizes-gallery.mjs
```

独立结构与破坏验证使用 Blender 自带 Python：

```powershell
$riverBlender = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
& $riverBlender --background --factory-startup --python-exit-code 1 --python experiments/3d-sample/verify_scene.py -- --artifact-dir artifacts/3d-river-town --blend artifacts/3d-river-town/scene.blend
& $riverBlender --background --factory-startup --python-exit-code 1 --python tests/three-d/blender_river_tamper.py -- --artifact-dir artifacts/3d-river-town
```
