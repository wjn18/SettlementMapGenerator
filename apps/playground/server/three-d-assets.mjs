import fs from 'node:fs/promises';
import path from 'node:path';
import { fileHash } from './three-d-cache.mjs';

async function shortRoadRecovery(dir,manifest,town) {
  if(!(town.roads?.length))return true;
  const scale=manifest.horizontalScale;
  if(!Number.isFinite(scale)||scale<=0)return false;
  const vertices=new Map((town.vertices??[]).map(vertex=>[vertex.id,vertex]));
  const shortIds=new Set();
  for(const road of town.roads) {
    for(let i=1;i<road.vertexIds.length;i++) {
      const a=vertices.get(road.vertexIds[i-1]),b=vertices.get(road.vertexIds[i]);
      if(!a||!b)return false;
      const length=Math.hypot(b.x*scale-a.x*scale,b.y*scale-a.y*scale);
      if(length>0&&length<.001)shortIds.add(road.id);
    }
  }
  if(!shortIds.size)return true;
  // Older ribbons dropped nonzero segments shorter than .001 scene units.
  // Roof-only recovery preserves those gaps, so require saved-mesh evidence
  // for every affected source road, bound to the exact four audited files.
  try {
    const report=JSON.parse(await fs.readFile(path.join(dir,'verification.json'),'utf8'));
    const files=['scene.blend','selection.json','source-town.json','scene-manifest.json'];
    const hashes=await Promise.all(files.map(file=>fileHash(path.join(dir,file))));
    if(files.some((file,i)=>report.sourceFilesSha256?.[file]!==hashes[i]))return false;
    if(report.horizontalScale!==scale||!Array.isArray(report.roads))return false;
    for(const id of shortIds) {
      const rows=report.roads.filter(road=>road.id===id);
      if(rows.length!==1||rows[0].sourceId!==id
        ||rows[0].checks?.centerlineCoverage!==true||rows[0].checks?.sourceWidthAndCoordinates!==true)return false;
    }
    return true;
  } catch {return false;}
}

/** Recovery may keep geometry only when it contains the current authored kits. */
export async function recoveryAssets(dir,root,town,{assetLibrary}={}) {
  let manifest;
  try {manifest=JSON.parse(await fs.readFile(path.join(dir,'scene-manifest.json'),'utf8'));}
  catch {return {reuse:false,reason:'The saved asset manifest is unavailable.'};}
  const integration=manifest.assetIntegration;
  if(manifest.roadSurfaces?.version!==4)return {reuse:false,reason:'The saved scene predates continuous road paving and flush dock surfaces.'};
  if(!await shortRoadRecovery(dir,manifest,town))return {reuse:false,reason:'Short nonzero source road segments lack matching saved-scene coverage and coordinate verification.'};
  if(!integration?.enabled)return {reuse:false,reason:'The saved scene predates the current authored asset libraries.'};
  const marketIds=town.districts.filter(d=>d.wardType==='Market').map(d=>d.id).sort();
  const fortifiedMarkets=marketIds.length>0&&(town.walls?.length??0)>0;
  if(marketIds.length>1||fortifiedMarkets) {
    const plazas=manifest.markets?.plazas;
    if(manifest.markets?.enabled!==true||manifest.markets?.version!==1||!Array.isArray(plazas)
      ||plazas.length!==marketIds.length||JSON.stringify(plazas.map(p=>p.id).sort())!==JSON.stringify(marketIds))
      return {reuse:false,reason:fortifiedMarkets?'The saved fortified markets lack structure-aware per-market assembly records.':'The saved scene predates complete per-market assembly and source identities.'};
  }
  if(manifest.markets?.version===1&&manifest.markets.propsEnabled!==false) {
    for(const market of manifest.markets.plazas??[]) {
      const props=market.props??{};
      if(fortifiedMarkets||(props.people??0)>0||(props.stalls??0)>0) {
        if(!Number.isInteger(props.reserved_structure_count)||props.reserved_structure_count<0
          ||props.people_structure_clearance_verified!==true)
          return {reuse:false,reason:'The saved market predates actual wall, tower and gate structure reservations.'};
      }
    }
  }
  if(town.river&&town.terrain?.coast&&(!manifest.estuary?.enabled||manifest.estuary.version!==1))return {reuse:false,reason:'The saved scene predates the current combined river-mouth and coastal geometry.'};
  if(town.river&&town.terrain?.coast&&manifest.props?.people>0&&(
    manifest.props.people_reserved_clearance_verified!==true||!(manifest.props.people_footprint_radius_m>0)
    ||!(manifest.props.reserved_water_count>=2)||!(manifest.props.reserved_passage_count>=(town.river.bridges?.length??0))))
    return {reuse:false,reason:'The saved estuary predates reserved river passages and water clearances for actual citizen footprints.'};
  const base=assetLibrary??path.join(root,'artifacts/small-town-assets/small-town-asset-library.blend');
  if(await fileHash(base)!==integration.librarySha256)return {reuse:false,reason:'The town asset library has changed.'};
  const kits=[];
  if(town.river)kits.push(['river_kit','river-assets','river-asset-library.blend']);
  const riverHarbor=town.terrain?.docks?.some(d=>d.waterbody==='river');
  if(town.terrain?.coast||riverHarbor)kits.push(['harbor_kit','harbor-assets','harbor-asset-library.blend']);
  if(riverHarbor&&manifest.harbor?.version!==2)return {reuse:false,reason:'The saved scene predates source-planned river berths.'};
  if(riverHarbor&&manifest.river?.bedLevel!==-3.6)return {reuse:false,reason:'The saved river bed lacks clearance for enlarged cargo vessels.'};
  const castles=new Set(town.districts.filter(d=>d.wardType==='Castle').map(d=>d.id));
  if(town.buildings.some(b=>castles.has(b.districtId)))kits.push(['castle_keep_kit','castle-assets','castle-asset-library.blend']);
  for(const [id,folder,file] of kits) {
    const entry=integration.additionalLibraries?.find(lib=>lib.kitId===id);
    const current=path.join(root,'artifacts',folder,file);
    if(!entry||await fileHash(current)!==entry.sha256)return {reuse:false,reason:`The ${id} library was added or updated.`};
    if(id==='harbor_kit') {
      if(await fileHash(path.join(root,'artifacts',folder,'asset-library.json'))!==entry.manifestSha256)return {reuse:false,reason:'The harbor hull profiles or assembly metadata have changed.'};
      if(!manifest.harbor?.enabled||!manifest.harbor.waterExclusion?.some(item=>item.object===(town.terrain?.coast?'Harbor_sea_surface':'River_water_surface')))return {reuse:false,reason:'The saved harbor predates the boat interior water exclusion.'};
      if(!Array.isArray(manifest.harbor.quayOpenings))return {reuse:false,reason:'The saved harbor predates flush dock walkways.'};
    }
    if(id==='river_kit') {
      if(!manifest.river?.enabled||manifest.river.version!==2)return {reuse:false,reason:'The saved scene predates the raised stone arch bridges.'};
      if(await fileHash(path.join(root,'artifacts',folder,'asset-library.json'))!==entry.manifestSha256)return {reuse:false,reason:'The river kit geometry or assembly metadata has changed.'};
    }
  }
  return {reuse:true,reason:'The saved scene uses the current authored libraries.'};
}
