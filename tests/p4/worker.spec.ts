import { test, expect } from '@playwright/test';
declare global { interface Window { __playground: any; __workers: { created: number; live: number }; __hangWorker: boolean } }
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    const NativeWorker=window.Worker;
    window.__workers={created:0,live:0};
    window.Worker=class extends NativeWorker {
      private stopped=false;
      constructor(url: string|URL, options?: WorkerOptions) {
        const hang=window.__hangWorker?URL.createObjectURL(new Blob(['while(true) {}'],{type:'text/javascript'})):null;
        super(hang??url,options);if(hang)URL.revokeObjectURL(hang);
        window.__workers.created++;window.__workers.live++;
      }
      terminate(){if(!this.stopped){window.__workers.live--;this.stopped=true;}super.terminate();}
    };
  });
  await page.goto('/?test=1&seed=42&size=15');await expect(page.locator('body')).toHaveAttribute('data-ready','true');
});
test('worker cancellation, latest request and repeated generation preserve UI and release workers',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const revision=await page.evaluate(()=>window.__playground.revision);
  await page.evaluate(async()=>{const pending=window.__playground.generate({seed:12345,size:40});window.__playground.cancel();await pending;});
  await expect(page.locator('#status')).toHaveText('已取消生成');
  expect(await page.evaluate(()=>window.__playground.revision)).toBe(revision);
  await page.evaluate(async()=>{
    const api=window.__playground;
    await Promise.all([api.generate({seed:1,size:40}),api.generate({seed:12345,size:6})]);
    for(let i=0;i<8;i++)await api.generate({seed:42+i,size:6});
  });
  expect(await page.evaluate(()=>window.__playground.town.resolved.seed)).toBe(49);
  expect(await page.evaluate(()=>window.__playground.revision)).toBe(revision+9);
  expect(await page.evaluate(()=>window.__workers.live)).toBe(0);
  await expect(page.locator('#generate')).toBeEnabled();await expect(page.locator('#cancel')).toBeHidden();expect(errors).toEqual([]);
});
test('a hung worker leaves map interaction responsive, times out, and the next request recovers',async({page})=>{
  await page.clock.install();
  await page.evaluate(()=>{window.__hangWorker=true;void window.__playground.generate({seed:1,size:40});});
  await page.locator('#zoom-in').click();await expect(page.locator('#zoom-label')).toHaveText('125%');
  await page.clock.fastForward(15001);await expect(page.locator('#error')).toContainText('生成超过 15 秒');
  expect(await page.evaluate(()=>window.__workers.live)).toBe(0);
  await page.evaluate(async()=>{window.__hangWorker=false;await window.__playground.generate({seed:12345,size:6});});
  await expect(page.locator('#error')).toBeHidden();expect(await page.evaluate(()=>window.__playground.town.resolved.seed)).toBe(12345);
});
