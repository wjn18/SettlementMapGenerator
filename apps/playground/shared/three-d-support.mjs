/** Shared capability boundary for the browser, local service and CLI. */
export function riverSupportError(town) {
  if(!town?.river)return '';
  if(!town.river.surface?.length)return '此旧河流规划缺少实际河面边界，暂不能生成三维；二维导入仍可使用。';
  if(!town.river.bridges?.length)return '河流规划没有连接两岸的桥梁，无法生成当前三维场景。';
  for(const bridge of town.river.bridges) {
    const road=town.roads.find(r=>r.id===bridge.roadId);
    if(!road||bridge.width-road.width<1)return '桥梁结构宽度不足以保留道路净宽和桥栏，请使用当前生成器重新生成规划。';
  }
  return '';
}
