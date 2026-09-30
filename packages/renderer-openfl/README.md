# @settlement/renderer-openfl

浏览器 OpenFL 9.5.2 绘制适配器，版本 `0.5.0`，GPL-3.0-only。使用 WebGL2，已验证 Chrome；不从 Node 导入此包。提供 ESM 与类型声明，P4 已通过实际 `.tgz` 在独立 Vite 项目中的开发/生产消费验证，见仓库 `examples/README.md`。

```ts
import { createOpenFLRenderer } from '@settlement/renderer-openfl';
import { fitViewport } from '@settlement/map-scene';

const renderer = createOpenFLRenderer(container);
renderer.resize(800, 800, window.devicePixelRatio);
renderer.render(scene);
renderer.setViewport(fitViewport(scene.bounds, 800, 800));
const districtId = renderer.pick(400, 400);
renderer.dispose();
```

`container` 应有明确宽高。`render` 读取有序 MapScene，调用者将其视为只读；`setViewport` 使用世界坐标中心和 CSS 像素/世界单位缩放；`resize` 接收正数 CSS 宽高和 DPR（0..8，不含 0）；`pick` 接收相对容器左上角的 CSS 坐标并返回地块 ID。平移、滚轮和提示由应用处理。

`dispose` 可重复调用；销毁后其他方法抛出错误。清理 Sprite/Graphics、窗口、DOM、WebGL 上下文、输入回调和应用模块。固定版本兼容逻辑位于 `runtime.ts`：Lime HTML5 的 `exit()` 为空，需要让已排队 RAF 回调停止继续调度并解绑其浏览器监听器。DPR 改变同样需要同步旧后端缓存。升级 OpenFL 时必须重新验证这两个内部接入点。P4 在独立项目 DPR 1/2 下各挂载/重绘/销毁 40 次：画布和 RAF 回到零，DOM 与监听器数稳定，预热后 JS 堆增长低于 2 MB。原始采样见仓库 `tests/fixtures/p4/package-report.json`；这不代表长期运行或 GPU 显存的完整保证。

命中计算独立于画布像素与 DOM 事件，按与旧版热区相同的后绘制优先顺序遍历多边形，缩放和 DPR 不改变 ID 结果。适配器不生成几何，不依赖页面控件，公共 API 不暴露 Sprite。

P5 修复多次重建后的空白地图：OpenFL 9.5.2 的静态 shader 对象不能跨 WebGL 上下文复用，现在为每个 Stage 分配独立 shader，并仅清理该实例拥有的缓存。除资源计数外，回归测试还比较重建前后的实际像素。公共 MapRenderer 类型由 map-scene 定义，本包继续重新导出该类型。
