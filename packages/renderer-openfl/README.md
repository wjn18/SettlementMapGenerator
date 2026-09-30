# @settlement/renderer-openfl

浏览器 OpenFL 9.5.2 绘制适配器，版本 `0.3.0`，GPL-3.0-only。使用 WebGL2，已验证 Chrome；不从 Node 导入此包。通过 Vite 使用工作区 ESM 与类型声明，独立打包消费验收留到 P4。

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

`dispose` 可重复调用；销毁后其他方法抛出错误。清理 Sprite/Graphics、窗口、DOM、WebGL 上下文、输入回调和应用模块。固定版本兼容逻辑位于 `runtime.ts`：Lime HTML5 的 `exit()` 为空，需要让已排队 RAF 回调停止继续调度并解绑其浏览器监听器。DPR 改变同样需要同步旧后端缓存。升级 OpenFL 时必须重新验证这两个内部接入点。当前测试反复挂载三次，检查画布数、全局监听器数与待执行 RAF 数没有累积；更长时间的内存压力测试属于 P4。

命中计算独立于画布像素与 DOM 事件，按与旧版热区相同的后绘制优先顺序遍历多边形，缩放和 DPR 不改变 ID 结果。适配器不生成几何，不依赖页面控件，公共 API 不暴露 Sprite。
