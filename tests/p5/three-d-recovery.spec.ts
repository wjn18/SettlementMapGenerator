import {test,expect} from '@playwright/test';

for(const reject of [false,true])test(`saved-scene retry preserves the plan and ${reject?'shows request errors':'selects the recovered task'}`,async({page})=>{
  const oldId='11111111-1111-4111-8111-111111111111',newId='22222222-2222-4222-8222-222222222222';
  const old={id:oldId,status:'failed',stage:'结构校验失败',quality:'high',createdAt:'2026-10-26T08:47:43.498Z',seed:869133548,size:80,buildings:1888,sourceHash:'saved-source',canRecover:true,error:'屋顶超出占地',files:{}};
  let jobs:any[]=[old],activeId:string|null=null,retries=0;
  await page.route('**/api/3d/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname===`/api/3d/jobs/${oldId}/retry`){
      expect(route.request().method()).toBe('POST');expect(route.request().postDataJSON()).toEqual({});retries++;
      if(reject)return route.fulfill({status:422,json:{error:'保存场景不可读取，请重新生成'}});
      const next={...old,id:newId,status:'running',stage:'正在恢复已保存场景',recoveredFrom:oldId,canRecover:false,error:undefined};
      jobs=[next,old];activeId=newId;return route.fulfill({status:202,json:next});
    }
    return route.fulfill({json:{available:true,activeId,jobs}});
  });
  await page.goto(`/?test=1&seed=7&size=6&castle=false&walls=true&plaza=true&view=3d&job=${oldId}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  await expect(page.locator('#three-d-history')).toHaveValue(oldId);
  await expect(page.locator('#three-d-retry')).toBeVisible();
  const original=await page.evaluate(()=>JSON.stringify((window as any).__playground.town));
  await page.locator('#three-d-retry').click();
  if(reject){
    await expect(page.locator('#three-d-error')).toHaveText('保存场景不可读取，请重新生成');
    await expect(page.locator('#three-d-retry')).toBeEnabled();
  }else{
    await expect(page.locator('#three-d-history')).toHaveValue(newId);
    await expect(page.locator('#three-d-stage')).toContainText('正在恢复已保存场景');
    await expect(page.locator('#three-d-retry')).toBeHidden();
  }
  expect(retries).toBe(1);expect(await page.evaluate(()=>JSON.stringify((window as any).__playground.town))).toBe(original);
});
