# P5 固定输入与评估记录

三个 TownData 文件由 core 算法 0.4.0 在 Node 24.19.0 中生成一次，比较页面直接载入 JSON，不分别调用生成器。它们覆盖城堡小镇（1/6）、城墙小城（42/15）和无墙都会（12345/40，castle=false、walls=false）。

另按用户要求补充 `town-citadel.json`、`town-dense.json`、`town-village.json`，用于城堡都会、密集街巷与无广场村落的视觉比较；这三组不混入原 54 组性能矩阵。

`report.json` 记录输入 SHA-256、浏览器、独立绘制器包体积、三种地图 × 三种绘制器 × DPR 1/2 × 缩放 0.5/1/4 的原始样本与中位数/P95，以及资源和像素差异统计。比较分开计时同步 API 与等待两个动画帧的墙钟时间；后者不是 GPU 计时器。每组预热三次、测量十二次，数据仅对当次机器和浏览器有代表性。

`screenshots/` 保存 1× 的 18 张审查图；完整 54 张截图位于运行输出 `artifacts/p5/`。`package-report.json` 保存新绘制器独立压缩包消费记录，`openfl-package-report.json` 保存 OpenFL 0.5.0 的独立消费记录。

运行 `npm run benchmark:p5` 会重新生成 artifacts，不自动覆盖本目录。性能波动正常，不用固定毫秒阈值作为回归断言；图像差异需先检查地图、视口、抗锯齿和绘制顺序，不能直接覆盖原图来消除失败。P1/P3 基线不受此次评估影响。
