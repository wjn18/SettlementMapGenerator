# 上游来源

- 原作者 / 仓库：watabou / TownGeneratorOS
- 地址：https://github.com/watabou/TownGeneratorOS
- 参考提交：`7fbc87a9398cc508af24de93f79cf2ad027f352b`
- 提交说明：Updated for compatibility with the latest versions of openfl and lime
- 导入日期：2026-09-29
- 本仓库： https://github.com/wjn18/SettlementMapGenerator

`legacy/TownGeneratorOS/` 包含该提交的 `Source/`、`Assets/`、`project.xml`、`README.md`、`.gitignore` 和 `LICENSE`，共 64 个文件。没有导入上游 `.git` 目录。P0 验收已逐文件与该提交的 Git blob 对照：63 个文本文件仅存在 Windows 检出造成的 CRLF / LF 差异，图片文件逐字节相同；没有源码内容差异。

[校验清单](upstream-manifest.json) 的 Git blob ID、SHA-256 和字节数直接取自上述上游提交对象，未以参考副本自证。SHA-256 使用上游原始字节；[离线校验脚本](../scripts/verify-upstream.mjs) 仅将本地文本的 CRLF 还原为 LF 后比较，二进制不作转换。构建输出目录 `legacy/TownGeneratorOS/Export/` 不参与文件清单校验。

保留本仓库已有的初始提交历史；上游来源通过提交哈希与此文档追溯。原始许可证为 GNU GPL v3 文本，根目录 `LICENSE` 复制自同一上游版本；本次没有进行重新许可或删除原作者声明。

上游 README 明确说明缺少水域、选项界面等功能。重构的初始功能基线以此参考提交为准，不以其他在线版本为准。

原构建配置声明 Lime 7.3.0、OpenFL 8.9.0、msignal 1.2.5；没有明确固定 Haxe 编译器版本。P1 已使用 Haxe 3.4.7 验证这组三方库的 HTML5 构建与浏览器运行，详见 [P1 验收记录](P1_ACCEPTANCE.zh-CN.md)。

P1 构建始终从本目录复制到被 Git 忽略的 `artifacts/`。原版构建不改源码，观测版只注入阶段采集调用；采集辅助代码保存在 `tools/legacy-harness/Baseline.hx`，不属于上游原始文件。npm 示例中的位图字体布局移植自上游 `BitmapText.hx`，字体图片直接引用原始资源，继续遵守本仓库许可。
