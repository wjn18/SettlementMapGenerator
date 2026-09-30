import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {PNG} from 'pngjs';
declare global {interface Window{__comparison:any;__playground:any}}
test('Canvas is the default; PNG and SVG exports preserve the active preview, theme and viewport',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?test=1&seed=42&size=15');await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  await expect(page.locator('#renderer')).toHaveValue('canvas');await expect(page).toHaveURL(/renderer=canvas/);
  await page.locator('#theme').selectOption('blueprint');await page.locator('#zoom-in').click();
  await page.locator('#map').focus();await page.keyboard.press('ArrowRight');
  const before=await page.evaluate(()=>({json:JSON.stringify(window.__playground.town),count:window.__playground.generationCount,view:window.__playground.viewport}));
  const dimensions=await page.locator('#map').evaluate(e=>({width:e.clientWidth,height:e.clientHeight}));
  for(const kind of ['canvas','svg','openfl']){
    await page.locator('#renderer').selectOption(kind);await expect(page).toHaveURL(new RegExp(`renderer=${kind}`));
    expect(await page.evaluate(()=>({json:JSON.stringify(window.__playground.town),count:window.__playground.generationCount,view:window.__playground.viewport}))).toEqual(before);
    const hit=await page.evaluate(()=>{const a=window.__playground,p=a.scene.hitRegions[0].points[0],v=a.viewport,host=document.querySelector('#map')!.getBoundingClientRect();return a.pick(host.width/2+(p.x-v.centerX)*v.zoom,host.height/2+(p.y-v.centerY)*v.zoom);});expect(hit).not.toBeNull();
    for(const format of ['png','svg']){
      const pending=page.waitForEvent('download');await page.locator(format==='svg'?'#export-svg':'#export-image').click();const download=await pending,bytes=readFileSync((await download.path())!);
      expect(download.suggestedFilename()).toBe(`settlement-42.${format}`);
      if(format==='svg'){
        const svg=await page.evaluate(xml=>{const doc=new DOMParser().parseFromString(xml,'image/svg+xml');return{error:!!doc.querySelector('parsererror'),namespace:doc.documentElement.namespaceURI,viewBox:doc.documentElement.getAttribute('viewBox'),background:doc.querySelector('rect')?.getAttribute('fill'),transform:doc.querySelector('g')?.getAttribute('transform'),paths:doc.querySelectorAll('path').length};},bytes.toString());
        expect(svg.error).toBe(false);expect(svg.namespace).toBe('http://www.w3.org/2000/svg');expect(svg.paths).toBeGreaterThan(0);
        expect(svg.viewBox).toBe(`0 0 ${dimensions.width} ${dimensions.height}`);expect(svg.background).toBe('#455b8d');
        expect(svg.transform).toBe(`translate(${dimensions.width/2} ${dimensions.height/2}) scale(${before.view.zoom}) translate(${-before.view.centerX} ${-before.view.centerY})`);
      }else{
        const png=PNG.sync.read(bytes),dpr=Number(info.project.use.deviceScaleFactor);expect([png.width,png.height]).toEqual([Math.round(dimensions.width*dpr),Math.round(dimensions.height*dpr)]);expect(bytes.length).toBeGreaterThan(10000);
      }
      await expect(page.locator('#renderer')).toHaveValue(kind);
      await expect(page.locator('#map canvas, #map svg')).toHaveCount(1);
      expect(await page.evaluate(()=>({json:JSON.stringify(window.__playground.town),count:window.__playground.generationCount,view:window.__playground.viewport}))).toEqual(before);
    }
  }
  expect(errors).toEqual([]);
});
test('comparison shares scene data and linked controls across all three renderers',async({page})=>{
  await page.goto('/compare.html?test=1');await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  await page.locator('#sample').selectOption('large');await page.locator('#scale').selectOption('4');
  await page.locator('#theme').selectOption('blueprint');
  const result=await page.evaluate(()=>{const a=window.__comparison;return{town:a.town.resolved,views:a.views,scene:a.scene.background};});
  expect(result.town.size).toBe(40);expect(result.scene).toBe('#455b8d');expect(result.views.svg).toEqual(result.views.canvas);expect(result.views.svg).toEqual(result.views.openfl);
  await page.locator('#reset').click();
  const hits=await page.evaluate(()=>{const a=window.__comparison,p=a.scene.hitRegions[0].points[0];return ['openfl','canvas','svg'].map(kind=>{const v=a.views[kind],host=document.getElementById(kind)!;return a.pick(kind,host.clientWidth/2+(p.x-v.centerX)*v.zoom,host.clientHeight/2+(p.y-v.centerY)*v.zoom);});});
  expect(hits[0]).not.toBeNull();expect(hits[1]).toBe(hits[0]);expect(hits[2]).toBe(hits[0]);
});
for(const kind of ['canvas','svg'])test(`${kind}: resize, invalid inputs, redraw and repeated disposal`,async({page})=>{
  await page.goto(`/compare.html?test=1&bench=${kind}`);await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const original=await page.evaluate(()=>JSON.stringify(window.__comparison.scene));
  await page.evaluate(()=>{const a=window.__comparison;for(let i=0;i<25;i++){a.dispose();a.dispose();a.mount();a.redraw();}a.resize(600,400,2);});
  const element=page.locator(`#${kind} > ${kind==='canvas'?'canvas':'svg'}`);await expect(element).toHaveCount(1);
  expect(await element.evaluate(e=>[Number(e.getAttribute('width')),Number(e.getAttribute('height'))])).toEqual(kind==='canvas'?[1200,800]:[600,400]);
  for(const value of [0,-1,NaN,Infinity])expect(await page.evaluate(value=>{try{window.__comparison.viewport({centerX:0,centerY:0,zoom:value});return false;}catch{return true;}},value)).toBe(true);
  expect(await page.evaluate(()=>JSON.stringify(window.__comparison.scene))).toBe(original);
});
test('native renderers preserve CSS stroke width and scale world strokes at 4×',async({page},info)=>{
  const dpr=Number(info.project.use.deviceScaleFactor);
  for(const kind of ['canvas','svg']){
    await page.goto(`/compare.html?test=1&bench=${kind}`);await expect(page.locator('body')).toHaveAttribute('data-ready','true');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.evaluate(()=>{
      const stroke={color:'#000000',width:4,units:'screen',cap:'butt',join:'miter',miterLimit:3};
      window.__comparison.synthetic({bounds:{minX:-100,minY:-100,maxX:100,maxY:100},background:'#ffffff',hitRegions:[],commands:[{kind:'polyline',points:[{x:-50,y:-20},{x:50,y:-20}],stroke},{kind:'polyline',points:[{x:-50,y:20},{x:50,y:20}],stroke:{...stroke,color:'#ff0000',units:'world'}}]});
      window.__comparison.viewport({centerX:0,centerY:0,zoom:4});
    });
    const png=PNG.sync.read(await page.locator(`#${kind}`).screenshot());
    const thickness=(y:number,red:boolean)=>{let count=0;for(let row=(y-12)*dpr;row<(y+12)*dpr;row++){const i=(row*png.width+400*dpr)*4;if(red?png.data[i]>200&&png.data[i+1]<50:png.data[i]<50&&png.data[i+1]<50)count++;}return count;};
    expect(thickness(320,false)).toBe(4*dpr);expect(thickness(480,true)).toBe(16*dpr);
  }
});
test('OpenFL redraws the same image after repeated context disposal',async({page})=>{
  const warnings:string[]=[];page.on('console',m=>{if(m.text().includes('INVALID_OPERATION'))warnings.push(m.text());});
  await page.goto('/compare.html?test=1&bench=openfl');await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await settle();
  const before=PNG.sync.read(await page.locator('#openfl').screenshot());
  for(let i=0;i<5;i++){await page.evaluate(()=>{window.__comparison.dispose();window.__comparison.mount();});await settle();const actual=PNG.sync.read(await page.locator('#openfl').screenshot());expect([actual.width,actual.height]).toEqual([before.width,before.height]);let total=0;for(let j=0;j<actual.data.length;j++)total+=Math.abs(actual.data[j]-before.data[j]);expect(total/actual.data.length).toBeLessThan(.001);}
  expect(warnings).toEqual([]);
});
test('extra maps, detail cameras and pixel differences make renderer comparison inspectable',async({page})=>{
  await page.goto('/compare.html?test=1&sample=citadel&detail=towers');await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  await expect(page.locator('#sample')).toHaveValue('citadel');await expect(page.locator('#scale')).toHaveValue('8');
  for(const sample of ['citadel','dense','village']){await page.locator('#sample').selectOption(sample);await page.locator('#detail').selectOption('buildings');expect(await page.locator('#scale').inputValue()).toBe('8');}
  await page.locator('#sample').selectOption('citadel');await page.locator('#detail').selectOption('towers');
  await page.locator('#difference').click();await expect(page.locator('.difference-layer')).toHaveCount(2);await expect(page.locator('#difference-note')).toBeVisible();
  await page.locator('#reset').click();await expect(page.locator('.difference-layer')).toHaveCount(0);await expect(page.locator('#scale')).toHaveValue('1');
});
