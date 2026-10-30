# 内河港口：二维规划到三维装配

生成器版本：0.19.0。支持纯内陆单河港口，以及四向河口中独立启停的海港和河港。

## 使用

网页开启「河流」，再选择「内河港口 → 顺岸码头与货运泊位」。`harbor` 控制原有海港，`riverHarbor` 控制河港，后者默认关闭并要求 `river: true`。

```js
generateTown({ seed: 7, size: 12, river: true, riverHarbor: true,
  coast: false, walls: false, castle: false, plaza: true });
```

```powershell
npm run sample:3d -- --seed 7 --size 12 --river true --river-harbor true --coast false --walls false --castle false --plaza true --preview --output artifacts/3d-river-harbor --name scene
npm run sample:3d -- --seed 7 --size 24 --river true --river-harbor true --coast east --harbor true --walls false --castle false --plaza true --preview --output artifacts/3d-estuary-river-harbor --name scene
```

导入 JSON 使用 `--input`，不能混用重新规划选项。两张交付样片均有 `planning.png` / `planning.svg`、`source-town.json`、`selection.json`、`scene.blend`、`city-center-render.png` 和 `verification.json`；网页三维历史直接显示它们。

## 二维规则与数据

河道、岸边道路、桥位和城门通道先确定，再筛选河港候选段。在建筑导出前预留装卸留空，保护教堂、城堡和市场地块。候选码头采用接岸段加顺岸平台，完整船舶矩形位于实际河面中，并避开海面、桥梁、其他泊位和码头。河港街区复用 Harbor 仓储类型。

每条河港码头记录 `waterbody: "river"` 和 `riverHarbor`：

- `version: 1`、`layout: "along-bank"`；
- `berth`：稳定 ID、船型 cargo / rowboat / cargo-sloop / cargo-ketch / cargo-lugger、中心、朝向（弧度）、长度和宽度；
- `yard`：装卸留空多边形；
- `navigation`：保留水路的路径、净宽和连接的河流端部 start / end。

所有坐标与长度跟随现有四倍规划尺度统一转换，导出单位和其他地图实体相同；朝向不缩放。适配器原样复制整个 terrain，并断言深度相等。三维只在指定泊位的尺寸范围内等比装配对应船型，不另行随机找位置。

水路按完整宽度检查并避开桥位，只选择能够连通河流端部的河段。河口优先选择靠近入海口的末端河段，但也允许连通上游地图边缘的端部河段。水路端点向地图水面边界内退一个净宽，保证整个通行矩形留在源水域内。此规则表达静态水平空间预留，不包含穿桥航线、掉头轨迹或实际航行模拟。三维石拱桥另行检查桥下中央开口与实际行人通道。

0.19.0 将无桅货船恢复到 0.17.0 的尺寸：优先泊位长 28.8、宽 9.2，空间紧张时长 25.6、宽 8.2。单桅、双桅、短桅宽体货运帆船的泊位分别为 38.4 × 12.8、41.6 × 14.4、36.8 × 15.2。码头宽度保持 5.4，平台随船长预留前后余量（均为导出规划单位）。

每座新河港先选择一艘无桅货船，再匹配最近的安全帆船泊位；至少保留两个泊位，大城市可扩展到四个。每个泊位分别记录船型、位置、朝向及独立预留水路，船只和水路不得互相堵塞。三款帆船按源岸段确定性分配，二维图以三角帆标识区分。候选不足时有界重试，不用随机装饰船补足。

沿用宽河道和 -3.6 的三维河床，桥台与码头桩保持河床支承；实际船底净空至少为 0.2 场景单位。旧 JSON 的单船河港和 rowboat 继续兼容，旧快照不被自动缩放。

schemaVersion 保持 1，新增字段由新版严格读取器识别。新版继续读取旧 JSON；缺少 waterbody 的旧码头仍按海港解释。旧程序不能读取新增的河港字段。

## 三维实现

`harbor_integration.py` 共享码头、仓库立面和船舱排水能力；只有有海岸时才创建海水和海岸地形。河港即使没有海岸，也加载港口素材库。

`river_harbor_geometry.py` 与 `river_integration.py` 使用共享岸线顶点的连续高度函数，把港口附近的自然坡岸平顺接到水平作业岸，保持岸体闭合和原水陆边界。`river_harbor_integration.py` 按源岸线装配压低的护岸压顶、装卸地面和计划船只。河港系船桩仅安装于平台水侧，尺寸较小，接岸通道不设系船桩。

港口库共 16 项资源：原无桅货船 `harbor_river_cargo_01` 与新增 `harbor_cargo_sloop_01`、`harbor_cargo_ketch_01`、`harbor_cargo_lugger_01` 三款货运帆船。帆船含货舱盖、尾舱、桅杆、缆绳与不同帆装，短桅款采用收拢的下帆。船只在自己的泊位范围内等比适配，包含实际模型的船体、船桨和其他外伸结构。所有船只完成装配后统一裁去海面、河面及水纹中的船舱截面。

`bridge_geometry.py` 根据源跨距生成两端接地的连续拱形桥面，`bridge_integration.py` 装配石拱券、护栏与两岸桥台，不在河心设置支桩。`verify_arch_bridge.py` 对实际保存网格检查原道路净宽、桥头连接、桥面上方 2.1 单位通行空间和桥下中央至少 2.2 单位净空。河流装配清单使用 river version 2，旧平桥场景重新构建。

三维清单记录 harbor version 2、源 dockId / berthId、实际船型、缩放和水域。构建器、校验器及素材清单加入缓存依赖；旧场景缺少河港版本、港口库或河面排水记录时从同一源规划重建。

## 校验与复现

二维严格校验码头道路引用、港区归属、泊位与装卸区、保留水路和旧档兼容。三维独立读取保存的实际网格，检查码头基础路径和宽度、桥面高度、通道上方障碍、船舶位置和朝向、实际船体包络、水路上的桥梁及其他船只。

内陆河面校验支持合法船体孔洞：实际水面应等于源河面扣除实际船体截面，同时检查源边界覆盖、重复面、越界水面和船舱内水面。河口分别检查河面扣除海面和河船截面，以及整个海河水域的覆盖面积。

```powershell
npm run build:packages
node --test tests/core/river-harbor.test.mjs tests/core/terrain.test.mjs tests/core/river.test.mjs tests/p3/river-harbor-scene.test.mjs
node --test tests/three-d/options.test.mjs tests/three-d/cache.test.mjs tests/three-d/recovery-assets.test.mjs
node --test tests/three-d/core-reload.test.mjs
node tests/three-d/river-harbor-integration.mjs
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python-exit-code 1 --python tests/three-d/blender_river_harbor_tamper.py
node tests/three-d/river-harbor-web.mjs
```

网页测试要求先用上方 sample:3d 命令生成两张带有效缓存签名和预览图的样片。它在隔离的本地服务和任务目录中验证开关、三种二维绘制器、JSON 导入导出、实际 POST、缓存复用、三维图片及 Blender 下载。

破坏测试只修改内存中的场景副本，覆盖船只上岸、进入桥位、码头顶点偏移、河水缺失和船舱进水；不覆盖原始 .blend 文件。

开发服务的校验与缓存模块通过相对路径引入已编译的 core，使其进入 Vite 配置依赖图。这样重建 core 后会更新服务校验器，避免页面已支持 `riverHarbor`、服务仍因 Node 模块缓存报 `request: invalid fields`。`core-reload.test.mjs` 在隔离目录预先缓存旧校验器，再修改传递依赖，验证同一 Node 进程中的 API 自动使用新版；不会修改正在使用的 core 或任务目录。

大场景（至少 20,000 个可渲染对象）的颜色与遮罩阶段复用原场景，线稿仅建立结构对象的临时场景，降低额外求值网格的内存开销。临时属性在成功或异常结束时恢复，不重写 `.blend`；小场景保留原渲染路径。城内取景逐个计算去重后的网格顶点范围，不把重复顶点数组保留到渲染阶段。`tests/three-d/blender_render_pipeline.py` 对照两条渲染路径的像素，并验证源状态恢复和异常清理。
