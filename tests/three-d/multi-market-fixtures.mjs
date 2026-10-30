// Controlled multi-market input plans, without changing generation policy.
// Existing empty land parcels become markets; every source coordinate and ID
// remains the original saved river-town plan. Provenance stays outside TownData.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { generateTown, serializeTown, deserializeTown, validateTown } from '@settlement/core';

export const sourcePlan='artifacts/3d-river-town/source-town.json';
export const marketCases=[
  {name:'zero',generated:true,options:{seed:42,size:6,river:true,walls:false,castle:false,plaza:false}},
  {name:'one',additional:[]},
  {name:'near',additional:['d4']},
  {name:'far',additional:['d75']},
  {name:'main',additional:['d53']},
];

export function addExistingEmptyMarkets(original,additional) {
  const town=structuredClone(original);
  for(const id of additional) {
    const district=town.districts.find(d=>d.id===id);
    assert.ok(district&&['Park','Ward'].includes(district.wardType),id+' must be an existing empty Park or Ward parcel.');
    assert.ok(!town.buildings.some(b=>b.districtId===id),id+' has building footprints.');
    assert.ok(!town.features.some(f=>f.districtId===id),id+' has a planned feature that should not be silently repurposed.');
    district.wardType='Market';
  }
  validateTown(town);
  assert.deepEqual({...town,districts:original.districts},original,'Converting empty land must not alter source geometry or IDs.');
  for(const district of town.districts) {
    const before=original.districts.find(d=>d.id===district.id);
    assert.deepEqual({...district,wardType:before.wardType},before);
  }
  return town;
}

// Keep the original test helper name available for existing Park-only cases.
export const addExistingParkMarkets=addExistingEmptyMarkets;

export async function writeMarketFixtures({root='artifacts/multi-market-tests',main='artifacts/3d-multi-market',only=null}={}) {
  const sourceText=await fs.readFile(sourcePlan,'utf8'),source=deserializeTown(sourceText);
  const provenance={source:path.resolve(sourcePlan),sourceSha256:createHash('sha256').update(sourceText).digest('hex'),
    policy:'Imported test planning snapshots. Additional markets reuse existing empty Park or Ward parcels; only wardType changes. Core automatic market counts are unchanged.',cases:[]};
  const result=[];
  for(const item of marketCases) {
    if(only&&item.name!==only)continue;
    let town;
    if(item.generated){const generated=generateTown(item.options);assert.ok(generated.ok,JSON.stringify(generated));town=generated.town;}
    else town=addExistingEmptyMarkets(source,item.additional);
    const dir=path.resolve(item.name==='main'?main:path.join(root,item.name));await fs.mkdir(dir,{recursive:true});
    const file=path.join(dir,'input.json');await fs.writeFile(file,serializeTown(town)+'\n');
    const ids=town.districts.filter(d=>d.wardType==='Market').map(d=>d.id).sort();
    const record={name:item.name,input:file,marketIds:ids,generated:Boolean(item.generated),convertedDistrictIds:item.additional??[],
      previousWardTypes:Object.fromEntries((item.additional??[]).map(id=>[id,source.districts.find(d=>d.id===id).wardType])),
      untouchedGeometry:!item.generated,buildings:town.buildings.length,river:Boolean(town.river)};
    await fs.writeFile(path.join(dir,'fixture-provenance.json'),JSON.stringify({...provenance,cases:[record]},null,2));
    provenance.cases.push(record);result.push({...record,town,dir});
  }
  await fs.mkdir(path.resolve(root),{recursive:true});
  if(only) {
    try {
      const existing=JSON.parse(await fs.readFile(path.resolve(root,'fixture-provenance.json'),'utf8'));
      provenance.cases=[...existing.cases.filter(c=>c.name!==only),...provenance.cases];
    } catch(error){if(error.code!=='ENOENT')throw error;}
  }
  await fs.writeFile(path.resolve(root,'fixture-provenance.json'),JSON.stringify(provenance,null,2));
  return result;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const index=process.argv.indexOf('--case');const result=await writeMarketFixtures({only:index<0?null:process.argv[index+1]});
  console.log(JSON.stringify({passed:true,cases:result.map(({town,...row})=>row)},null,2));
}
