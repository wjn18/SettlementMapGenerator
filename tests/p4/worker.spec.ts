import { test, expect, type Page } from '@playwright/test';
declare global { interface Window { __playground: any; __workers: { created: number; live: number }; __hangWorker: boolean } }
declare global { interface Window { __controlledWorkers: any[]; __pendingGeneration: Promise<void> } }

async function useControlledWorkers(page: Page) {
  await page.clock.install();
  await page.evaluate(() => {
    window.__controlledWorkers = [];
    // Keep a captured callback so tests can simulate messages queued before termination.
    class ControlledWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror = null; onmessageerror = null; terminations = 0;
      captured: ((event: MessageEvent) => void) | null = null;
      constructor() { window.__controlledWorkers.push(this); window.__workers.created++; window.__workers.live++; }
      postMessage() { this.captured = this.onmessage; }
      terminate() { if (this.terminations++ === 0) window.__workers.live--; }
      emit(data: unknown, queued = false) { (queued ? this.captured : this.onmessage)?.(new MessageEvent('message', { data })); }
    }
    window.Worker = ControlledWorker as unknown as typeof Worker;
  });
}

async function startControlled(page: Page, size = 40) {
  await page.evaluate(size => { window.__pendingGeneration = window.__playground.generate({ seed: 7, size }); }, size);
}

async function progress(page: Page, attempt: number, stage: string, index = -1, queued = false) {
  await page.evaluate(({ attempt, stage, index, queued }) => {
    window.__controlledWorkers.at(index).emit({ type: 'progress', progress: { attempt, stage } }, queued);
  }, { attempt, stage, index, queued });
}

async function completeControlled(page: Page, index = -1, queued = false) {
  await page.evaluate(({ index, queued }) => {
    window.__controlledWorkers.at(index).emit({ type: 'result', result: { ok: true, town: structuredClone(window.__playground.town) } }, queued);
  }, { index, queued });
}

const snapshot = (page: Page) => page.evaluate(() => ({ town: JSON.stringify(window.__playground.town), revision: window.__playground.revision }));
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
  await page.clock.fastForward(15001);await expect(page.locator('#error')).toContainText('15 秒内未返回进度');
  expect(await page.evaluate(()=>window.__workers.live)).toBe(0);
  await page.evaluate(async()=>{window.__hangWorker=false;await window.__playground.generate({seed:12345,size:6});});
  await expect(page.locator('#error')).toBeHidden();expect(await page.evaluate(()=>window.__playground.town.resolved.seed)).toBe(12345);
});

test('genuine progress keeps a slow request alive beyond 15 seconds without replacing the current map early', async ({ page }) => {
  await useControlledWorkers(page);
  const before = await snapshot(page);
  await startControlled(page); await progress(page, 1, 'buildPatches');
  await page.clock.fastForward(10_000); await progress(page, 1, 'terrain');
  await page.clock.fastForward(10_001);
  await expect(page.locator('#status')).toContainText('第 1 次尝试 · 水系规划已完成');
  await expect(page.locator('#error')).toBeHidden(); await expect(page.locator('#cancel')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await progress(page, 1, 'buildWalls'); await completeControlled(page);
  await page.evaluate(() => window.__pendingGeneration);
  expect((await snapshot(page)).revision).toBe(before.revision + 1);
  expect(await page.evaluate(() => window.__workers.live)).toBe(0);
  expect(await page.evaluate(() => window.__controlledWorkers[0].terminations)).toBe(1);
  await expect(page.locator('#generate')).toBeEnabled(); await expect(page.locator('#cancel')).toBeHidden();
});

for (const [size, seconds] of [[40, 15], [100, 30]]) test(`a ${size}-district request detects a stalled stage despite duplicate progress`, async ({ page }) => {
  await useControlledWorkers(page);
  const before = await snapshot(page);
  await startControlled(page, size); await progress(page, 2, 'buildStreets');
  await page.clock.fastForward(seconds * 1000 - 1000);
  await expect(page.locator('#cancel')).toBeVisible(); await expect(page.locator('#error')).toBeHidden();
  await progress(page, 2, 'buildStreets');
  await page.clock.fastForward(1001); await page.evaluate(() => window.__pendingGeneration);
  await expect(page.locator('#error')).toContainText(`生成进度停滞超过 ${seconds} 秒`);
  await expect(page.locator('#error')).toContainText('第 2 次尝试，道路与桥梁');
  await completeControlled(page, 0, true);
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => window.__workers.live)).toBe(0);
  expect(await page.evaluate(() => window.__controlledWorkers[0].terminations)).toBe(1);
  await expect(page.locator('#generate')).toBeEnabled(); await expect(page.locator('#cancel')).toBeHidden();
});

test('repeated genuine retries cannot extend the total generation budget beyond 120 seconds', async ({ page }) => {
  await useControlledWorkers(page);
  const before = await snapshot(page);
  await startControlled(page); await progress(page, 1, 'buildPatches');
  for (let attempt = 2; attempt <= 12; attempt++) {
    await page.clock.fastForward(10_000); await progress(page, attempt, 'buildPatches');
  }
  await expect(page.locator('#error')).toBeHidden();
  await page.clock.fastForward(10_001); await page.evaluate(() => window.__pendingGeneration);
  await expect(page.locator('#error')).toContainText('生成总耗时超过 120 秒');
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => window.__workers.live)).toBe(0);
  expect(await page.evaluate(() => window.__controlledWorkers[0].terminations)).toBe(1);
});

test('cancelled and superseded workers cannot publish stale progress or results or disable cancellation', async ({ page }) => {
  await useControlledWorkers(page);
  const before = await snapshot(page);
  await startControlled(page); await progress(page, 1, 'buildPatches');
  await startControlled(page); await progress(page, 2, 'terrain');
  const status = await page.locator('#status').textContent();
  await progress(page, 9, 'buildGeometry', 0, true); await completeControlled(page, 0, true);
  await expect(page.locator('#status')).toHaveText(status!); expect(await snapshot(page)).toEqual(before);
  await page.evaluate(async () => { window.__playground.cancel(); await window.__pendingGeneration; });
  await expect(page.locator('#status')).toHaveText('已取消生成');
  await progress(page, 10, 'buildGeometry', 1, true); await completeControlled(page, 1, true);
  await expect(page.locator('#status')).toHaveText('已取消生成'); expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => window.__controlledWorkers.map(worker => worker.terminations))).toEqual([1, 1]);
  expect(await page.evaluate(() => window.__workers.live)).toBe(0);
  await startControlled(page); await progress(page, 1, 'buildGeometry'); await completeControlled(page);
  await page.evaluate(() => window.__pendingGeneration);
  expect((await snapshot(page)).revision).toBe(before.revision + 1);
  expect(await page.evaluate(() => window.__workers.live)).toBe(0);
});

test('the reported 100-district coast and river harbor map completes without a generation timeout', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const before = await snapshot(page);
  const working = await page.evaluate(() => {
    window.__pendingGeneration = window.__playground.generate({ seed: 358600429, size: 100, coast: 'east', river: true, harbor: true, riverHarbor: true, castle: true, walls: true, plaza: true, maxAttempts: 40 });
    return { cancelAvailable: !document.getElementById('cancel')!.hidden, generationDisabled: (document.getElementById('generate') as HTMLButtonElement).disabled };
  });
  expect(working).toEqual({ cancelAvailable: true, generationDisabled: true });
  await page.evaluate(() => window.__pendingGeneration);
  await expect(page.locator('#error')).toBeHidden(); await expect(page.locator('#generate')).toBeEnabled();
  const result = await page.evaluate(() => ({ request: window.__playground.town.request, districts: window.__playground.town.districts.filter((district: any) => district.withinCity).length, docks: window.__playground.town.terrain.docks.filter((dock: any) => dock.waterbody === 'river').length, revision: window.__playground.revision }));
  expect(result.request).toMatchObject({ seed: 358600429, size: 100, riverHarbor: true, maxAttempts: 40 });
  expect(result.districts).toBeGreaterThanOrEqual(100); expect(result.docks).toBeGreaterThanOrEqual(2);
  expect(result.revision).toBe(before.revision + 1); expect(await page.evaluate(() => window.__workers.live)).toBe(0);
  expect(errors).toEqual([]);
});
