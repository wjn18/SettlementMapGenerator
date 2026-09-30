# 上游来源

- 原作者 / 仓库：watabou / TownGeneratorOS
- 地址：https://github.com/watabou/TownGeneratorOS
- 参考提交：`7fbc87a9398cc508af24de93f79cf2ad027f352b`
- 提交说明：Updated for compatibility with the latest versions of openfl and lime
- 导入日期：2026-09-29
- 本仓库： https://github.com/wjn18/SettlementMapGenerator

迁移期间曾将该提交的 `Source/`、`Assets/`、`project.xml`、`README.md`、`.gitignore` 和 `LICENSE` 共 64 个文件保存到 `legacy/TownGeneratorOS/`。没有导入上游 `.git` 目录。P0 验收已逐文件与该提交的 Git blob 对照：63 个文本文件仅存在 Windows 检出造成的 CRLF / LF 差异，图片文件逐字节相同；没有源码内容差异。

[校验清单](upstream-manifest.json) 的 Git blob ID、SHA-256 和字节数直接取自上述上游提交对象，未以参考副本自证。清单作为历史来源元数据保留，不要求当前源码树继续包含 64 个原始文件。现在 `npm run verify:assets` 仅校验仍在使用的字体和根许可证；文本统一 CRLF / LF 后比较，图片按原始字节比较。

2026-09-30 完成迁移核对后，从当前源码树删除了 59 个上游 Haxe 文件、旧项目配置、重复说明和许可证，以及基线采集 Haxe 文件和专用构建脚本。根目录与各 TypeScript 包的许可证、作者来源和既有 Git 历史继续保留；这次清理不改变许可。

上游 README 明确说明缺少水域、选项界面等功能。重构的初始功能基线以此参考提交为准，不以其他在线版本为准。

原构建配置声明 Lime 7.3.0、OpenFL 8.9.0、msignal 1.2.5；没有明确固定 Haxe 编译器版本。P1 已使用 Haxe 3.4.7 验证这组三方库的 HTML5 构建与浏览器运行，详见 [P1 验收记录](P1_ACCEPTANCE.zh-CN.md)。

位图字体布局移植自上游 `BitmapText.hx`；原字体图片已原样迁入 [assets/fonts/maroubra.png](../assets/fonts/maroubra.png)，由两个 TypeScript 应用共享。已保存的阶段数据和截图继续位于 `tests/fixtures/`，普通回归测试直接消费这些数据，无需重新构建 Haxe。

## 历史实现与重新采集

清理前的完整源码、工具链版本清单和采集脚本保存在本仓库提交
[`72a554199cd775933f684ab55a2cf91562284ab4`](https://github.com/wjn18/SettlementMapGenerator/tree/72a554199cd775933f684ab55a2cf91562284ab4)。
历史 P0–P4 验收记录中的 `verify:upstream`、`legacy:*`、`baseline:*` 命令只适用于该历史版本，已从当前 package.json 移除。

只有确实需要重建历史基线时，才在独立目录检出该提交，再按该版本的 P1 文档安装旧工具链和采集。不要将旧源码恢复到当前开发目录，也不要自动覆盖已审查的期望值。当前使用 `npm run verify:fixtures` 检查基线完整性，使用 `npm run test:p2:browser` 对比同浏览器的旧版阶段。
