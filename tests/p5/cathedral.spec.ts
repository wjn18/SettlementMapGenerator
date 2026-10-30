import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { TERRAIN_GENERATOR_VERSION } from '../../packages/core/dist/index.js';

test('reported triangular church becomes a regular plan across renderers and JSON roundtrip', async ({page},info) => {
  const errors: string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?test=1&seed=869133548&size=80&castle=true&walls=true&plaza=true&maxAttempts=40&river=false&coast=false&labels=false&grid=false&theme=parchment');
  await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  const saved=await page.evaluate(()=>JSON.stringify((window as any).__playground.town));
  const report=await page.evaluate(()=> {
    const api=(window as any).__playground,t=api.town,v=new Map<string,any>(t.vertices.map((p:any)=>[p.id,p]));
    const church=t.districts.find((d:any)=>d.wardType==='Cathedral');
    const parts=t.buildings.filter((b:any)=>b.districtId===church.id);
    return {version:t.generatorVersion,district:church.id,districtCorners:church.boundary.length,
      parts:parts.map((b:any)=>({role:b.architecturalRole,corners:b.boundary.length,lengths:b.boundary.map((id:string,i:number)=>{
        const a=v.get(id),c=v.get(b.boundary[(i+1)%b.boundary.length]);return Math.hypot(c.x-a.x,c.y-a.y);
      })}))};
  });
  expect(report.version).toBe(TERRAIN_GENERATOR_VERSION); expect(report.district).toBe('d111');
  expect(report.districtCorners).toBeGreaterThan(4); expect(report.parts).toHaveLength(4);
  expect(report.parts.map((p:any)=>p.role)).toEqual(['main_hall','bell_tower','annex','annex']);
  expect(report.parts.every((p:any)=>p.corners===4 && Math.min(...p.lengths)>=6)).toBe(true);
  for(const renderer of ['canvas','svg','openfl']) {
    await page.locator('#renderer').selectOption(renderer);
    expect(await page.evaluate(()=>JSON.stringify((window as any).__playground.town))).toBe(saved);
  }
  const download=page.waitForEvent('download'); await page.locator('#export').click();
  const bytes=readFileSync((await(await download).path())!); expect(JSON.parse(bytes.toString())).toEqual(JSON.parse(saved));
  await page.locator('#file').setInputFiles({name:'church.json',mimeType:'application/json',buffer:bytes});
  await expect(page.locator('#status')).toContainText('已导入');
  expect(await page.evaluate(()=>(window as any).__playground.town)).toEqual(JSON.parse(saved));
  await page.screenshot({path:`artifacts/church-layout-fix/${info.project.name}-page.png`});
  expect(errors).toEqual([]);
});
