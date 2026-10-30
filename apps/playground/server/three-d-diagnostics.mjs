import fs from 'node:fs/promises';
import path from 'node:path';

/** Keep the original log, but give failed history entries a readable cause. */
export async function failureDiagnostics(dir) {
  let report;
  try {report=JSON.parse(await fs.readFile(path.join(dir,'verification.json'),'utf8'));}
  catch {return {};}
  if(report.status!=='fail'||!Array.isArray(report.failures)||!report.failures.length)return {};
  const failures=report.failures.filter(value=>typeof value==='string');
  const explain=message=>{
    const feature=message.match(/Planned feature is missing or its required region footprint changed: (\S+)/);
    if(feature) {
      const kind=report.features?.find(item=>item.id===feature[1])?.kind;
      return `${({grove:'树丛',fountain:'喷泉',statue:'雕像'})[kind]??'规划要素'} ${feature[1]} 的占地校验未通过`;
    }
    if(message.includes('actual sea boundary or water level'))return '海面边界或水位校验未通过';
    if(message.includes('Sea coverage changed'))return '海面覆盖面积校验未通过';
    const building=message.match(/Building footprint, identity or placement mismatch: (\S+)/);
    if(building)return `建筑 ${building[1]} 的占地或位置校验未通过`;
    return '三维结构或素材位置校验未通过';
  };
  const reasons=[...new Set(failures.map(explain))];
  return {failedStage:'verify_scene',validationFailures:failures,
    errorSummary:reasons.slice(0,3).join('；')+'。'+(failures.length>1?`共 ${failures.length} 项，请查看技术详情或重试。`:'请查看技术详情或重试。')};
}
