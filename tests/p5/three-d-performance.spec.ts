import {test,expect} from '@playwright/test';
import { openSidebarTask } from '../helpers/sidebar';

for(const fail of [false,true])test(`on-demand view ${fail?'keeps the old picture and error':'reuses the scene and updates the URL'}`,async({page})=>{
  const parent='33333333-3333-4333-8333-333333333333',derived='44444444-4444-4444-8444-444444444444';
  const old={id:parent,status:'complete',stage:'已完成',quality:'high',requestedView:'center',hasCastle:true,createdAt:'2026-10-27T08:00:00Z',finishedAt:'2026-10-27T08:01:00Z',seed:7,size:6,buildings:107,sourceHash:'source',files:{'city-center-render.png':`/api/3d/jobs/${parent}/files/city-center-render.png`}};
  let jobs:any[]=[old],activeId:string|null=null,requests=0;
  await page.route('**/api/3d/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('.png'))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XnIoAAAAASUVORK5CYII=','base64')});
    if(url.pathname===`/api/3d/jobs/${parent}/render`){
      expect(route.request().postDataJSON()).toEqual({view:'full'});requests++;
      if(fail)return route.fulfill({status:422,json:{error:'保存场景已改变，请重新生成'}});
      const next={...old,id:derived,status:'running',stage:'正在复用相同规划的校验场景',requestedView:'full',reusedSceneFrom:parent,files:{}};
      jobs=[next,old];activeId=derived;return route.fulfill({status:202,json:next});
    }
    return route.fulfill({json:{available:true,jobs,activeId}});
  });
  await page.goto(`/?test=1&seed=7&size=6&castle=false&walls=true&plaza=true&view=3d&job=${parent}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready','true');await expect(page.locator('#three-d-image')).toBeVisible();
  const original=await page.evaluate(()=>JSON.stringify((window as any).__playground.town));
  await page.locator('#three-d-framing').selectOption('full');
  if(fail){
    await expect(page.locator('#three-d-error')).toHaveText('保存场景已改变，请重新生成');
    await page.waitForTimeout(2700); // Polling must not erase a request failure.
    await expect(page.locator('#three-d-error')).toHaveText('保存场景已改变，请重新生成');
    await expect(page.locator('#three-d-framing')).toHaveValue('center');await expect(page.locator('#three-d-image')).toBeVisible();
  }else{
    await expect(page.locator('#three-d-history')).toHaveValue(derived);await expect(page).toHaveURL(new RegExp('job='+derived));
    await expect(page.locator('#three-d-meta')).toContainText('复用已保存场景');await expect(page.locator('#three-d-framing')).toBeDisabled();
  }
  expect(requests).toBe(1);expect(await page.evaluate(()=>JSON.stringify((window as any).__playground.town))).toBe(original);
});

test('an instant finished-result cache hit does not show a running task',async({page})=>{
  const id='55555555-5555-4555-8555-555555555555';let jobs:any[]=[];
  await page.route('**/api/3d/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/3d/jobs'&&route.request().method()==='POST'){
      const body=route.request().postDataJSON();expect(body.quality).toBe('preview');
      const job={id,status:'complete',stage:'已完成 · 复用相同规划的已校验结果',quality:'preview',requestedView:'center',hasCastle:false,cacheHit:'result',reusedResultFrom:'previous',createdAt:new Date().toISOString(),finishedAt:new Date().toISOString(),seed:7,size:6,buildings:107,sourceHash:'source',files:{}};
      jobs=[job];return route.fulfill({status:202,json:job});
    }
    return route.fulfill({json:{available:true,activeId:null,jobs}});
  });
  await page.goto('/?test=1&seed=7&size=6&castle=false&walls=true&plaza=true');
  await expect(page.locator('body')).toHaveAttribute('data-ready','true');await expect(page.locator('#three-d-generate')).toBeEnabled();
  await openSidebarTask(page, 'three-d');
  await page.locator('#three-d-generate').click();
  await expect(page.locator('#three-d-history')).toHaveValue(id);await expect(page.locator('#three-d-meta')).toContainText('复用已完成结果');
  await expect(page.locator('#three-d-cancel')).toBeHidden();await expect(page.locator('#three-d-progress')).toBeHidden();await expect(page.locator('#three-d-generate')).toBeEnabled();
  await expect(page.locator('#three-d-framing option[value="castle"]')).toBeDisabled();
});
