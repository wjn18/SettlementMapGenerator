# 内陆河流、石拱桥与历史木桥素材

当前城市使用 `bridge_geometry.py` 与 `bridge_integration.py` 按源桥位生成石拱桥。桥面沿跨度连续抬高，两端保持原道路高度；石拱券、护栏和两端桥台在实际场景中生成，不设河心木桩。装配清单为 river version 2，实际网格由 `verify_arch_bridge.py` 检查桥面净宽、桥头连接与中央桥洞净空。下面的 7 项素材保留为河岸参考和历史木桥资源，木桥模块不再用于新城桥梁。

首批交付 7 个原生三维模块或参数化剖面参考，沿用小镇素材库的 30 个语义材质槽、低饱和木石色彩与统一淡彩线稿渲染。素材源文件、GLB 和纹理均保存在本地，无需在线素材服务。

交付目录为 `artifacts/river-assets/`，包含 `river-asset-library.blend`、7 个 `glb/` 文件、打包纹理、`asset-library.json`、`verification.json`、素材总览与 `river-assets.zip`。

## 模块与坐标

所有模块使用米制、`+Z` 向上，桥局部 `+X` 沿跨度，`+Y` 横桥。`Z=0` 是桥面基准，不等于全部资产的底部；装配时使用明确的连接点。源模型尺寸与三维场景的统一比例在装配入口换算。

| 资产 ID | 网格部件 | 原始尺寸与安装规则 |
| --- | --- | --- |
| `river_bank_profile_01` | `bank` | 长 4m 的自然岸与河床剖面参考，`+Y` 朝陆地；实际城市岸面按源河面和可用干地生成，不用固定块替换岸线 |
| `river_quay_transition_01` | `transition` | 沿 X 长 0.6m、最大厚 0.54m，顶 Z=0、底 -2；可缩短的护岸与桥台收口，不跨桥头通行面 |
| `bridge_timber_deck_01` | `deck`、`beams` | 沿 X 长 4m、沿 Y 宽 2m；桥板顶 0、底 -0.16，梁架范围 -0.42 至 -0.16；长桥重复拼装，梁架单独安装 |
| `bridge_timber_support_01` | `support` | 宽 2m 的双桩与斜撑，顶 -0.38、底 -2；安装时围绕指定连接点适配桥底与河床 |
| `bridge_abutment_01` | `abutment` | 沿 X 长 0.8m、宽 2m，顶 -0.16、底 -2；放在岸内承接桥面，不产生横封桥头的台阶 |
| `bridge_rail_01` | `rail` | 沿 X 长 2m，Y 厚 0.12m，Z 范围 0.06 至 1m；放在道路净通行带外 |
| `bridge_rail_end_01` | `end` | 最大宽 0.22m，Z 范围 0 至 1.06m；栏杆端头，不作非等比拉伸 |

清单记录每个模块的安装面、原点、允许伸缩轴与范围、连接点、网格部件、GLB 实际字节和 SHA-256。桥面包含连续的下层板和有拼缝的上层木板；栏杆、梁架、支桩与桥面分开，避免整桥任意缩放。

`river_bank_profile_01` 同时交付可编辑的剖面样块与 `profileYZ` 配方。三维集成应保持实际 `river.surface` 水边界，在陆侧空间内生成坡面或竖直岸壁，不能把样块铺在完整地板上形成重叠面。

## 重建与独立验证

在 `SettlementMapGenerator/` 目录运行：

```powershell
$riverBlender = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
& $riverBlender --background --factory-startup --python-exit-code 1 --python experiments/3d-sample/build_river_assets.py -- --render
& $riverBlender --background artifacts/river-assets/river-asset-library.blend --python-exit-code 1 --python experiments/3d-sample/verify_asset_library.py -- --asset-dir artifacts/river-assets --expected-assets 7 --expected-groups 2
```

验证器重新打开已保存库并逐个导入交付的 GLB，检查文件哈希、嵌入纹理、语义材质槽、UV、有限坐标、网格数量、原点和实际米制边界。`verification.json` 记录最终库的哈希。素材验证与整城结构验证分别执行；场景中的桥面净宽、桥头连接、河床支承和水陆分离由河流场景验证器检查。
