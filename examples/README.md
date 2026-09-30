# 独立消费示例

三个包均为 ESM，版本 `0.4.0`，包含 TypeScript 声明和 GPL-3.0-only 许可证。尚未发布到 npm，使用本地 `.tgz` 安装。

在仓库根目录运行：

```sh
npm ci --cache .cache/npm
npm run test:p4:packages
```

该命令构建并将三个压缩包保存到 `artifacts/p4/`，随后把本目录示例复制到系统临时目录中的两个独立项目，以离线模式安装实际压缩包。Node 项目只装 core，并在禁用 DOM、时钟和环境随机数后运行；浏览器项目装三个包，检查声明、开发/生产构建、DPR 1/2 和资源释放。依赖来自 `.cache/npm`，首次准备缓存需执行上面的 `npm ci`。独立项目保留在系统临时目录 `settlement-p4-*` 中供排查。

## Node.js

将 `node/main.mjs`、`node/worker.mjs` 和 `settlement-core-0.4.0.tgz` 复制到一个新目录，然后运行：

```sh
npm init -y
npm install ./settlement-core-0.4.0.tgz
node main.mjs
```

示例验证同步调用、JSON 往返以及 Worker 中的生成结果一致。只有 core 进入运行依赖图。

## 浏览器

将 `browser/` 中的文件及三个 `.tgz` 复制到新目录，运行：

```sh
npm init -y
npm pkg set type=module
npm install ./settlement-core-0.4.0.tgz ./settlement-map-scene-0.4.0.tgz ./settlement-renderer-openfl-0.4.0.tgz
npm install --save-dev vite@8.3.1 typescript@5.9.3
npx vite
```

`main.ts` 展示生成 → 场景 → 绘制、尺寸与视口设置以及幂等销毁。运行 `npx vite build` 可得到静态页面。实际项目需要自动适应容器时，可参照 playground 的 ResizeObserver；可取消的后台生成见 `apps/playground/src/generation-task.ts`。

请随分发保留许可证与来源。OpenFL 在 renderer 包中固定为 9.5.2；core 不需要浏览器或 OpenFL。
