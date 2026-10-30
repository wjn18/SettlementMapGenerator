# 沿海港口城市：素材与三维接入

当前港口库包含 **16 个可编辑三维模块/变体**，沿用现有低饱和石材、木材、亚麻布与青绿色水面，以及统一线稿淡彩渲染。内河泊位混合使用 `harbor_river_cargo_01` 无桅货船和三款货运帆船（`harbor_cargo_sloop_01`、`harbor_cargo_ketch_01`、`harbor_cargo_lugger_01`）；码头和仓库构件由海港与河港共用。源文件与纹理不依赖在线素材服务。内河接入见[内河港口说明](../../docs/RIVER_HARBOR_IMPLEMENTATION.zh-CN.md)。

## 船舱干燥修正

船体现有连续木质舱底、内衬、舷缘厚度与封闭首尾。`hullProfile` 描述真实外壳各高度的截面；`harbor_water.py` 在海面、浅水和涟漪网格上分别按对应高度裁出船体内部，保持源海岸外边界及船外水面覆盖面积。不能靠抬高整船处理进水，也不能仅封闭船底后仍让连续海面穿过船舱。

保存后的校验对每艘船执行 15 个舱内位置的实际三角面射线检查：水线附近不得命中任何水层，下方必须命中木质舱底。还比较海面面积与所有船体截面的排除面积，防止通过删除整个海面掩盖问题。破坏测试会重新向三款船舱填入海面，要求校验全部拒绝。静态船只移动或缩放后需要重新装配水面排除区域。旧结果不会自动修改，重新生成后使用修正后的素材与海面。

| 类别 | 资产 ID | 交付内容 |
| --- | --- | --- |
| 海水 | `harbor_sea_01` | 海面淡彩材质、可平铺颜料纹理及断续涟漪样片 |
| 护岸 | `harbor_quay_01`、`harbor_quay_corner_01`、`harbor_quay_steps_01` | 石砌直段、转角及下水台阶 |
| 码头 | `harbor_dock_deck_01`、`harbor_dock_piles_01`、`harbor_bollard_01` | 分缝木桥面、双桩斜撑、系船桩与绳圈 |
| 仓库 | `harbor_warehouse_door_01`、`harbor_warehouse_hoist_01` | 大货门、石楣、装卸雨棚及吊货梁 |
| 新增货运帆船 | `harbor_cargo_sloop_01`、`harbor_cargo_ketch_01`、`harbor_cargo_lugger_01` | 单桅、双桅、短桅宽体；货舱、尾舱、缆绳与差异帆装 |
| 无桅货船 | `harbor_river_cargo_01` | 恢复 0.17.0 停泊尺寸的原货船 |
| 船只 | `harbor_rowboat_01`、`harbor_fishing_boat_01`、`harbor_merchant_ship_01` | 划艇、单桅渔船、小型商用帆船 |

交付位于 `artifacts/harbor-assets/`：`harbor-asset-library.blend`、16 个 `glb/` 文件、打包与内嵌纹理、`asset-library.json`、独立 GLB 回读 `verification.json`、预览图和 `harbor-assets.zip`。米制、+Z 朝上；船首为局部 +X，局部 Z=0 是水线；码头沿 +Y 延伸，桥面 Z=0；护岸及仓储立面局部 -Y 朝外。清单标注安装面、尺寸、允许伸缩轴及连接点。

## 规划与装配

`export-minimal-town.mjs` 原样复制 `terrain.coast`、`terrain.docks` 与滨水道路引用。`harbor_integration.py` 从同一份数据装配：

1. 用实际岸线裁出陆地，移除原有矩形地块覆盖海面的部分；海面保持源多边形的外边界，排除停泊船体内部，水位固定为场景 Z=-1.15。
2. 在已开发滨水道路附近沿岸线铺石护岸，未开发岸段保留自然岸线。在实际码头通行宽度两侧各预留 0.4 场景单位，降低该范围内压顶至桥面下方，保留下部挡墙；道路 Z=.035，木板 Z=.037，以 2mm 的渲染偏移避免接面闪烁。转角和台阶作为可用备选模块保留。
3. 按每条源码头的实际路径和宽度拼木桥面、支撑及系船桩；保留岸侧道路连接和规划 ID。
4. 港区建筑保留原墙体与屋顶，安装适合现有立面的货门和雨棚；按檐高限制构件，删除与货门相交的普通门窗/木构装饰，并避开邻栋与道路。
5. 按稳定顺序尝试三款船的泊位，检查整船投影（含桨、帆与索具）位于海面内，并避开所有码头和已放置船只。没有安全泊位时在清单记录跳过原因。

船只数量由可用泊位决定，不保证每张规划都能停齐三款。船只、护岸细节与仓库立面设计属于三维解释，不能宣称是二维规划中原本存在的独立实体。`scene-manifest.json.harbor` 和 `asset-integration.json` 记录实际使用与来源。护岸、码头和船的结构轮廓纳入现有原生线稿叠加，海面不描多边形构建边。

网页、命令行、水域支持限制及缓存依赖已同步接入。港口库字节与机器清单参与场景缓存签名；校验器与渲染器仍有各自失效边界。旧内陆场景的装配行为保持原规则。

直接命令行和旧任务重试也走同一条素材装配路径。`--coast`、`--harbor`、`--river`、`--walls`、`--castle`、`--plaza` 随同种子和规模传入二维规划；已有 JSON 输入不混入新的规划参数。恢复任务先核对当前主素材库、城堡库、港口库及港口机器清单：一致时复用保存场景，过期时从同一源规划重建。实际采用的恢复方式记录在 `pipeline-performance.json.recoveryMode`。

## 重建与验证

在项目根目录运行（Blender 路径可通过 `BLENDER_PATH` 配置）：

```powershell
$blenderExe = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
& $blenderExe --background --factory-startup --python-exit-code 1 --python experiments/3d-sample/build_harbor_assets.py -- --render
& $blenderExe --background artifacts/harbor-assets/harbor-asset-library.blend --python-exit-code 1 --python experiments/3d-sample/verify_asset_library.py -- --asset-dir artifacts/harbor-assets --expected-assets 16 --expected-groups 5
python tests/three-d/test_harbor_geometry.py
node tests/three-d/harbor-integration.mjs
& $blenderExe --background --factory-startup --python-exit-code 1 --python tests/three-d/blender_harbor_tamper.py
node tests/three-d/harbor-web.mjs
npm run sample:3d -- --seed 7 --size 6 --coast east --harbor true --river false --walls false --castle false --plaza true --preview --output artifacts/harbor-town --name scene
npm run sample:3d -- --input artifacts/3d-harbor/input-town.json --output artifacts/3d-harbor --name scene --details
node --test tests/three-d/options.test.mjs tests/three-d/recovery-assets.test.mjs tests/three-d/cache.test.mjs
node tests/three-d/recovery-integration.mjs
```

`verify_harbor.py` 从保存后的实际网格独立检查海面坐标、水位、水陆分离、码头路径与宽度、护岸贴线、仓储檐高、船只水线及泊位避让；原有整城建筑、道路、城墙、门洞、公共要素与素材校验照常执行。`blender_harbor_tamper.py` 实际改坏海面顶点、码头顶点、船只停泊位置和仓库高度，证明校验器会拒绝这些错误，且不保存对原场景的改动。

整城管线现已支持四个海岸方向、无港口海岸、内陆河、河口桥梁和多个市场。海水和帆船均为静态几何；潮汐和航行模拟尚未接入。
