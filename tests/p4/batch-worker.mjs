import { parentPort } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { generateTown, serializeTown, deserializeTown } from '../../packages/core/dist/index.js';
import { pointInRing } from '../../packages/map-scene/dist/index.js';
parentPort.on('message', options => {
  try {
    const start=performance.now(), result=generateTown(options), elapsedMs=performance.now()-start;
    const again=generateTown(options);
    if(JSON.stringify(result)!==JSON.stringify(again)) throw new Error('Non-deterministic generation');
    if(!result.ok) { parentPort.postMessage({options,elapsedMs,error:result.error}); return; }
    const town=result.town,json=serializeTown(town);
    if(serializeTown(deserializeTown(json))!==json) throw new Error('Lossy JSON round trip');
    const vertices=new Map(town.vertices.map(v=>[v.id,v]));
    const districts=new Map(town.districts.map(d=>[d.id,d.boundary.map(id=>vertices.get(id))]));
    let outside=0;
    for(const b of [...town.buildings,...town.features]) {
      const ring=districts.get(b.districtId);
      if(b.boundary.some(id=>!pointInRing(ring,vertices.get(id)))) outside++;
    }
    const roadEndpoints=new Set(town.roads.filter(r=>r.kind==='street').flatMap(r=>[r.vertexIds[0],r.vertexIds.at(-1)]));
    const targetVertices=new Set(town.districts.filter(d=>d.wardType==='Market').flatMap(d=>d.boundary));
    const missingEntrances=town.entrances.filter(id=>!roadEndpoints.has(id)&&!targetVertices.has(id)&&!(vertices.get(id).x===town.center.x&&vertices.get(id).y===town.center.y));
    if(missingEntrances.length) throw new Error('Entrance without an interior street');
    parentPort.postMessage({options,elapsedMs,attempts:town.resolved.attempts,buildings:town.buildings.length,outside,sha256:createHash('sha256').update(json).digest('hex')});
  } catch(error) { parentPort.postMessage({options,exception:String(error.stack||error)}); }
});
