# 多市场三维装配修复

三维流程已支持输入规划中的全部市场广场。网页、后端和 CLI 的单市场拦截已移除；每个来源 `Market` 地块分别生成地面、摊位、人物与道具，并逐市场验证。零市场、单市场与多个市场沿用同一流程。

## 装配与归属

`market_integration.py` 从全部 `Market` 地块建立清单，按市场 ID 生成独立随机种子。广场地面使用唯一对象名，每个陈设及其后续替换件写入 `source_market_id`。全部素材挂接到场景后，再统计每个市场最终的对象列表，喷泉及货物构件不会漏掉归属。

`props.py` 的多次调用共享占用记录，按实际网格水平半径避让其他市场的摊位、人物、车辆及固定规划要素。人物可以沿附近道路活动，但不会进入另一市场地块，也会避开水域、桥面与桥头。城墙、塔楼和门楼附件的实际水平轮廓同样参与预留，后期庭院长椅也遵守这项约束。容量不足的地块记录 `limited` 或 `empty` 及原因，不改动道路或建筑来强塞摊位。

`verify_markets.py` 逐项核对来源市场 ID、地面占地、陈设数量、最终对象归属、公共要素唯一性、跨市场网格相交，以及全部市场陈设与城防的实际网格相交。旧单市场场景仍能用原对象名验证。缓存要求多市场报告完整通过；旧多市场场景缺少装配版本或来源清单时按原规划重建。有城墙的旧单市场如果缺少结构避让记录，也从原规划重建；无墙旧单市场与零市场保留兼容。

本次修复针对三维装配。二维自动生成的市场数量规则保持原状，导入包含多个市场的规划时会完整装配。

## 演示样片

`artifacts/3d-multi-market/` 包含 3200 × 3200 成图、`scene.blend`、源规划及校验报告。主输入沿用现有河城的全部几何，仅将城门外无建筑和公共要素的空 `Ward d53` 声明为市场；转换说明在 `fixture-provenance.json`，没有修改建筑、地块边界、道路、桥梁、河流或城墙。

| 市场 | 位置 | 摊位 | 人物 |
| --- | --- | ---: | ---: |
| d9 | 原城内主市场 | 10 | 84 |
| d53 | 城门附近的城外次级市场 | 8 | 84 |

结构报告中 `markets.passed=true`、`verifiedMarkets=2`，建筑数仍为 225，河流和桥梁校验通过，市场与城防网格相交为零。结构与破坏报告对应场景 SHA-256：`224a8926b03e3fe644b3f18ff5a3dfcc6d7c0f9ea621795f13661c35b49f56ba`。

## 验证

- 共享占用纯 Python 行为测试 7 项通过。
- 实际 Blender 相邻双市场测试通过：独立归属、无跨市场网格碰撞、布局确定性、重复市场 ID 拒绝；狭小第三市场能够明确返回合法空场状态。
- 83 项能力、缓存、恢复和 CLI 测试通过。
- 零市场、单市场、近邻双市场、远距双市场的完整装配及结构验证通过，报告位于 `artifacts/multi-market-tests/report.json`。
- 八项实际破坏全部正确拒绝：删除第二广场、改变轮廓、错贴归属、删除第二市场陈设、漏报物件、跨市场重叠、加入幽灵市场、市场物件穿入城墙。
- 最终保存场景的独立实网格复核通过：240 个市场网格与 198 个城防网格的真实相交为零，报告位于 `artifacts/3d-multi-market/markets-fortification-audit.json`。
- 原河口港城规划导入当前生成器回归通过：市场、河流、河口、港口与建筑报告全部通过，市场与城防相交为零。单独输出位于 `artifacts/multi-market-estuary-regression/`。
- 网页构建及最终浏览器验收通过：真实提交返回 202，命中已验证结果缓存，两个市场的数量及来源与原规划一致，图片与场景下载正常。报告位于 `artifacts/multi-market-web-test/web-verification.json`，临时服务已关闭。

## 复现

在 `SettlementMapGenerator/` 运行：

```powershell
npm run sample:3d -- --input artifacts/3d-multi-market/input.json --output artifacts/multi-market-reproduction --name scene --resolution 3200
python tests/three-d/test_market_placement.py
node tests/three-d/multi-market-integration.mjs
node tests/three-d/multi-market-web.mjs --reuse-sample --require-stalls --port 5175
```

网页可导入 `source-town.json` 查看相同双市场规划，三维历史中可选择“多市场河城样片”。
