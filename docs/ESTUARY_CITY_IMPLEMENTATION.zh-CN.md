# 河口定居点三维生成交付

已在内陆单河基础上接通河流与海岸组合，支持东南西北海岸、港口开关、木平桥及现有城墙和城堡。网页、CLI、规划 JSON 导入、缓存与恢复使用同一装配链，历史结果新增“河口定居点样片”。

## 水陆和设施

`estuary_geometry.py` 使用实际源河岸与海岸的交点拼接水陆区域。海面保留源边界，河面只保留海面之外的部分，两者共用河口接缝。两岸陆地由联合水域一次裁出，岸坡在河口收窄为零，桥位、道路和建筑占地继续取自源规划。护岸按源海岸线段的干燥区间拼装，不跨河口。

`river_integration.py` 和 `harbor_integration.py` 共享这份地形计划，避免重复地板。海、河保持相同水位与材质。码头保持源路径和宽度，船只在海面内挑选泊位，并避开河口水道。全部河海水面、浅水与水纹层参与船体内部排水。

市场人物统一在实例化前避开桥面、桥头和水域，按实际人物资源的水平占用半径预留距离。该修复覆盖客户组、沿路人物和随机补充人物，保留独立桥梁通行校验。

当前使用现有河流、木桥及港口资源，无新增在线素材依赖。支持范围为当前核心生成器的单河与单侧海岸；支流、岛屿、石拱桥、内河码头和航运高程仍为后续内容。

## 交付样片

目录为 `artifacts/3d-estuary-town/`，参数为 seed 7、size 12、coast east、river true、harbor true、walls true、castle false、plaza true。

| 文件 | 内容 |
| --- | --- |
| `city-center-render.png` | 3200 × 3200 线稿淡彩成图 |
| `scene.blend` | 可编辑完整场景 |
| `source-town.json`、`selection.json` | 原规划与逐实体适配数据 |
| `planning.png`、`planning.svg` | 同一规划的二维对照 |
| `scene-manifest.json` | 河流、河口、港口及人物装配记录 |
| `verification.json` | 保存后独立读取实际网格的结构校验 |
| `estuary-tamper-verification.json` | 七项实际网格破坏测试 |
| `asset-integration.json` | 使用的素材和来源 |
| `pipeline-performance.json` | 导出、装配、校验和渲染耗时 |

最终结构校验 PASS：201 栋建筑、121 条道路、29 段有效墙体、5 个城门、11 个公共要素、1 座木桥、3 座码头和 3 艘船。河口跨越的 3 条源海岸线段全部保持开放，河海水面无重复覆盖，船舱保持干燥。

结构报告、破坏报告和场景对应同一 SHA-256：`297cd5392515388879484821693ad3381b9638ec4216d2e63609c8ca96b502df`。

## 验证结果

- 河口几何 8 项、原内陆河几何 7 项、港口几何 8 项、人物避让 7 项单测通过。
- 36 张实际规划通过河海分区、面积互补和三角化检查。
- 能力、缓存、恢复与 CLI 共 59 项测试通过；旧河口场景缺少人物避让记录时使用原规划重新装配。
- 7 组实际 Blender 场景通过：四向河口，其中南侧组合城墙和城堡；西侧关闭港口；内陆河；普通海岸。报告位于 `artifacts/estuary-tests/report.json`。
- 7 项破坏均被正确拒绝：河海叠水、抬高海面、删除河面、地板盖河口、护岸封河口、移动桥头、新水层灌入船舱。
- 网页构建及最终真实浏览器验收通过：提交返回 202、命中已验证结果缓存、原规划一致、三项水域报告通过、3200 像素图片与场景下载正常。报告和截图位于 `artifacts/estuary-web-test/`，临时服务已关闭。

## 复现

在 `SettlementMapGenerator/` 运行：

```powershell
npm run sample:3d -- --seed 7 --size 12 --coast east --river true --harbor true --walls true --castle false --plaza true --output artifacts/estuary-reproduction --name scene --resolution 3200

# 使用已交付源规划保留同一布局。
npm run sample:3d -- --input artifacts/3d-estuary-town/source-town.json --output artifacts/estuary-import --name scene --preview

python tests/three-d/test_estuary_geometry.py
python tests/three-d/test_market_clearance.py
node tests/three-d/estuary-integration.mjs
node tests/three-d/estuary-web.mjs --reuse-sample --port 5175
```

Blender 路径沿用现有默认配置，也可设置 `BLENDER_PATH`。将海岸改为 `south / west / north` 可生成其他方向，`--harbor false` 保留河海地形并关闭港区码头和船只。
