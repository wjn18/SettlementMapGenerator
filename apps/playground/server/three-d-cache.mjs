import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { serializeTown } from '../../../packages/core/dist/index.js';

export const sceneFiles = ['scene.blend','scene-manifest.json','asset-integration.json','selection.json','source-town.json','planning.png','planning.svg','adapter-verification.json','build-timing.json'];
export const imageForView = view => ({center:'city-center-render.png',full:'scene-render.png',castle:'castle-wall-detail.png'})[view];
export const townHash = town => createHash('sha256').update(serializeTown(town)).digest('hex');
const hash = data => createHash('sha256').update(data).digest('hex');
export const fileHash = async file => hash(await fs.readFile(file));

/** Geometry, verifier and renderer have separate invalidation boundaries. */
export async function fingerprints(root) {
  const dir=path.join(root,'experiments/3d-sample');
  const build=['render_sample_v2.py','road_surface.py','buildings_v2.py','asset_integration.py','castle_integration.py','castle_layout.py','fitted_mesh.py','footprint_geometry.py','harbor_geometry.py','harbor_integration.py','harbor_water.py','river_geometry.py','estuary_geometry.py','river_integration.py','bridge_integration.py','illustration_v2.py','planning_features.py','props.py','market_clearance.py','market_placement.py','market_integration.py','roof_ridges.py','shopfronts_v2.py','spatial_index.py'];
  const verification=['verify_scene.py','verify_markets.py','verify_integrated_assets.py','verify_harbor.py','verify_river.py','verify_estuary.py','river_geometry.py','estuary_geometry.py','planar_coverage.py','harbor_geometry.py','footprint_geometry.py','spatial_index.py'];
  const rendering=['render_pipeline.py','render_views.py'];
  build.push('river_harbor_geometry.py','river_harbor_integration.py','river_boats.py');
  verification.push('verify_river_harbor.py','verify_port_water.py','river_boats.py');
  build.push('bridge_geometry.py');
  verification.push('bridge_geometry.py','verify_arch_bridge.py');
  const digest=async names=>hash(JSON.stringify(await Promise.all(names.map(async name=>[name,await fileHash(path.join(dir,name))]))));
  const libraries=[];
  for(const rel of ['artifacts/small-town-assets/small-town-asset-library.blend','artifacts/castle-assets/castle-asset-library.blend','artifacts/harbor-assets/harbor-asset-library.blend','artifacts/harbor-assets/asset-library.json','artifacts/river-assets/river-asset-library.blend','artifacts/river-assets/asset-library.json']) {
    try {libraries.push([rel,await fileHash(path.join(root,rel))]);} catch(e) {if(e.code!=='ENOENT')throw e;}
  }
  const adapter=await fileHash(path.join(dir,'export-minimal-town.mjs'));
  const towers=await fileHash(path.join(root,'packages/core/dist/wall-towers.js'));
  return {version:1,scene:hash(JSON.stringify([await digest(build),adapter,towers,libraries])),verification:await digest(verification),rendering:await digest(rendering)};
}

export async function inspectCache(dir,{sourceHash,fingerprint,quality,view,resolution=3200}) {
  try {
    const signature=JSON.parse(await fs.readFile(path.join(dir,'cache-signature.json'),'utf8'));
    if(signature.version!==2 || signature.sourceHash!==sourceHash || signature.fingerprint.scene!==fingerprint.scene)return null;
    const report=JSON.parse(await fs.readFile(path.join(dir,'verification.json'),'utf8'));
    if(report.status!=='pass' || report.assetIntegration?.passed===false)return null;
    const source=JSON.parse(await fs.readFile(path.join(dir,'source-town.json'),'utf8'));
    if(townHash(source)!==sourceHash)return null;
    if(source.river&&source.terrain?.coast&&report.estuary?.passed!==true)return null;
    if(source.terrain?.docks?.some(d=>d.waterbody==='river')&&report.harbor?.riverHarbor?.passed!==true)return null;
    const marketIds=source.districts.filter(d=>d.wardType==='Market').map(d=>d.id).sort();
    if(report.markets?.passed===false)return null;
    if(marketIds.length>1) {
      const rows=report.markets?.plazas;
      if(report.markets?.enabled!==true||report.markets?.version!==1||report.markets?.passed!==true||!Array.isArray(rows)
        ||rows.length!==marketIds.length||rows.some(row=>row.passed!==true)
        ||JSON.stringify(rows.map(row=>row.id).sort())!==JSON.stringify(marketIds))return null;
    }
    // Check actual bytes, never a job label or timestamp. Modified .blend,
    // planning data and manifests invalidate reuse even if a report says pass.
    const required=['scene.blend','scene-manifest.json','selection.json','source-town.json','asset-integration.json','verification.json'];
    if(required.some(file=>!signature.artifactsSha256?.[file]))return null;
    const hashes=Object.fromEntries(await Promise.all(Object.keys(signature.artifactsSha256).map(async file=>{
      if(![...sceneFiles,'verification.json'].includes(file))throw new Error('Invalid cached artifact name');
      return [file,await fileHash(path.join(dir,file))];
    })));
    if(Object.entries(signature.artifactsSha256).some(([file,digest])=>hashes[file]!==digest))return null;
    for(const file of ['scene.blend','scene-manifest.json','selection.json','source-town.json'])if(hashes[file]!==report.sourceFilesSha256?.[file])return null;
    const image=imageForView(view),entry=signature.images?.[image];
    const sameVerifier=signature.fingerprint.verification===fingerprint.verification;
    let result=false;
    if(sameVerifier&&signature.fingerprint.rendering===fingerprint.rendering&&signature.quality===quality&&entry) {
      try {
        const bytes=await fs.readFile(path.join(dir,image));
        const width=view==='castle'?(quality==='preview'?1600:2200):(quality==='preview'?1500:Number(resolution));
        const height=view==='castle'?Math.round(width/1.2):width;
        result=hash(bytes)===entry&&bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
          &&bytes.readUInt32BE(16)===width&&bytes.readUInt32BE(20)===height;
      }catch{/* A missing photo still permits scene reuse. */}
    }
    return {dir,signature,scene:true,result:Boolean(result),sameVerifier};
  } catch {return null;}
}

export async function copyArtifacts(source,destination,{images=false,view}={}) {
  const files=[...sceneFiles,'verification.json'];
  for(const file of files) {
    try {await fs.copyFile(path.join(source,file),path.join(destination,file));}
    catch(e) {if(e.code!=='ENOENT')throw e;}
  }
  if(images) {
    const signature=JSON.parse(await fs.readFile(path.join(source,'cache-signature.json'),'utf8')),copied={};
    const names=view?[imageForView(view)]:Object.keys(signature.images??{});
    for(const file of names) {
      if(!['city-center-render.png','scene-render.png','castle-wall-detail.png'].includes(file)||!signature.images?.[file])continue;
      try {
        const bytes=await fs.readFile(path.join(source,file));
        if(hash(bytes)!==signature.images[file])continue;
        await fs.writeFile(path.join(destination,file),bytes);copied[file]=signature.images[file];
      }catch(e){if(e.code!=='ENOENT')throw e;}
    }
    signature.images=copied;
    await fs.writeFile(path.join(destination,'cache-signature.json'),JSON.stringify(signature,null,2));
  }
}

export async function writeSignature(dir,{sourceHash,fingerprint,quality,imageFiles}) {
  const images={};
  for(const file of imageFiles??['city-center-render.png','scene-render.png','castle-wall-detail.png']) {
    try {images[file]=await fileHash(path.join(dir,file));}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const artifactsSha256={};
  for(const file of [...sceneFiles,'verification.json']) {
    try {artifactsSha256[file]=await fileHash(path.join(dir,file));}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const signature={version:2,sourceHash,fingerprint,quality,images,artifactsSha256};
  await fs.writeFile(path.join(dir,'cache-signature.json'),JSON.stringify(signature,null,2));
  return signature;
}
