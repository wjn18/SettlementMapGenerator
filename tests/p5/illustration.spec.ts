import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {PNG} from 'pngjs';

test('illustrated water, woods, farmland, piers and landmark symbols survive rendering and export',async({page},info)=>{
  await page.setViewportSize({width:1514,height:1034});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?test=1&seed=12345&size=24&coast=east&river=true&harbor=true&castle=true&plaza=true&walls=true&theme=illustrated&grid=false&labels=false&scale=true&compass=true');
  await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  await expect(page.locator('#theme')).toHaveValue('illustrated');
  const original=await page.evaluate(()=>JSON.stringify((window as any).__playground.town));
  await page.screenshot({path:`artifacts/illustrated-map/${info.project.name}-first-look.png`});
  // Both the classic controls and the task sidebar can host this shared map.
  if(await page.locator('#task-generate').count())await page.locator('#task-generate').click();
  const advanced=page.locator('#sidebar-advanced');
  if(await advanced.count()&&await advanced.getAttribute('open')===null)await advanced.locator('summary').click();
  for(const renderer of ['canvas','svg','openfl']){
    await page.locator('#renderer').selectOption(renderer);
    await expect(page.locator('#map')).toBeVisible();
    await page.waitForTimeout(200);
    expect(await page.evaluate(()=>JSON.stringify((window as any).__playground.town))).toBe(original);
    await page.screenshot({path:`artifacts/illustrated-map/${info.project.name}-${renderer}.png`});
  }
  await page.locator('#renderer').selectOption('canvas');
  if(await page.locator('#task-files').count())await page.locator('#task-files').click();
  for(const format of ['svg','png']){
    const pending=page.waitForEvent('download');await page.locator(format==='svg'?'#export-svg':'#export-image').click();
    const bytes=readFileSync((await(await pending).path())!);
    if(format==='svg'){
      const svg=bytes.toString();expect(svg).toContain('#91aaa9');expect(svg.match(/<(path|circle)\b/g)!.length).toBeGreaterThan(3000);
      expect(svg).toContain('<pattern');expect(svg).toContain('data:image/png;base64,');
      expect(svg).not.toMatch(/href="https?:/); // Grain is embedded; ornaments remain vectors.
    }else expect(PNG.sync.read(bytes).width).toBeGreaterThan(1000);
  }
  const before=await page.locator('#map canvas').screenshot();
  await page.locator('#theme').selectOption('blueprint');
  expect(await page.evaluate(()=>JSON.stringify((window as any).__playground.town))).toBe(original);
  const after=await page.locator('#map canvas').screenshot();expect(Buffer.compare(before,after)).not.toBe(0);
  expect(errors).toEqual([]);
});

test('all twelve papers include fine detail and old parchment links select the retained paper',async({page},info)=>{
  await page.goto('/?test=1&seed=12345&size=24&coast=east&river=true&harbor=true&castle=true&plaza=true&walls=true&theme=parchment&grid=false&labels=false');
  await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  await expect(page.locator('#theme')).toHaveValue('illustrated');
  await expect(page.locator('#theme option')).toHaveCount(12);
  await expect(page.locator('#theme option[value="parchment"]')).toHaveCount(0);
  const before=await page.evaluate(()=>{const a=(window as any).__playground;return{town:JSON.stringify(a.town),generation:a.generationCount,details:a.scene.illustration,landmarks:a.scene.landmarks};});
  const themes=await page.locator('#theme option').evaluateAll(nodes=>nodes.map(node=>(node as HTMLOptionElement).value));
  for(const theme of themes){
    await page.locator('#theme').selectOption(theme);
    const state=await page.evaluate(()=>{const a=(window as any).__playground;return{town:JSON.stringify(a.town),generation:a.generationCount,details:a.scene.illustration,landmarks:a.scene.landmarks};});
    expect(state).toEqual(before);
    if(['illustrated','blueprint','monochrome','modern'].includes(theme))await page.locator('#map').screenshot({path:`artifacts/all-paper-details/${info.project.name}-${theme}.png`});
  }
  await page.goto('/compare.html?test=1&theme=parchment&bench=canvas');
  await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  await expect(page.locator('#theme')).toHaveValue('illustrated');
  await expect(page.locator('#theme option')).toHaveCount(12);
  expect(await page.evaluate(()=>(window as any).__comparison.scene.illustration.trees)).toBeGreaterThan(0);
});
