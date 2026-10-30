# 建筑图片素材

教堂（`church.png`）、城堡（`castle.png`）和集市（`market.png`）为内置 `image_gen` 生成的透明 PNG 原图。模式为 generate，`transparent_background=true`，未使用参考图。完整提示词保存在 [prompts.json](prompts.json)。

运行 `node scripts/compile-landmark-icons.mjs` 将原图缩放为 96px 的透明度和灰度图块，生成 `src/landmark-assets.ts`；`--check` 检查图块与原图一致。保留原图中的轮廓、明暗和透明背景；运行时由 `landmarkBitmap` 根据图纸的深色和浅色同步着色，无需等待网络图片加载。

Canvas、SVG、OpenFL 共用这三幅图片及相同位置，PNG/SVG 导出包含图片；SVG 以 PNG data URL 内嵌，导出文件不依赖外部素材。该图层仅作建筑地标标注，不改变生成器几何、种子和命中街区。
