import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {PNG} from 'pngjs';

async function showRendererControl(page:any){
  if(await page.locator('#task-generate').count())await page.locator('#task-generate').click();
  const advanced=page.locator('#sidebar-advanced');
  if(await advanced.count()&&await advanced.getAttribute('open')===null)await advanced.locator('summary').click();
}

test('building images stay embedded in all renderer previews and exported PNG/SVG files',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?test=1&seed=12345&size=24&coast=east&river=true&harbor=true&castle=true&plaza=true&walls=true&theme=illustrated&grid=false&labels=false');
  await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  const original=await page.evaluate(()=>JSON.stringify((window as any).__playground.town));
  const images=await page.evaluate(()=>(window as any).__playground.scene.commands.filter((command:any)=>command.kind==='image').map((command:any)=>({icon:command.icon,center:command.center,width:command.width,height:command.height})));
  expect(images.map((image:any)=>image.icon).sort()).toEqual(['castle','church','market']);
  for(const renderer of ['canvas','svg','openfl']){
    await showRendererControl(page);await page.locator('#renderer').selectOption(renderer);
    if(renderer==='svg'){
      const nodes=page.locator('#map image[data-landmark-icon]');await expect(nodes).toHaveCount(images.length);
      for(const image of await nodes.all()){
        await expect(image).toHaveAttribute('href',/^data:image\/png;base64,/);
        await expect(image).toHaveAttribute('aria-label',/\S/);
      }
    }
    // No network image or preload phase is needed before a fresh export.
    if(await page.locator('#task-files').count())await page.locator('#task-files').click();
    for(const format of ['svg','png']){
      const pending=page.waitForEvent('download');await page.locator(format==='svg'?'#export-svg':'#export-image').click();
      const bytes=readFileSync((await(await pending).path())!);
      if(format==='svg'){
        const xml=bytes.toString();
        expect(xml.match(/data-landmark-icon=/g)?.length).toBe(images.length);
        for(const icon of ['church','castle','market'])expect(xml).toContain(`data-landmark-icon="${icon}"`);
        expect(xml).toContain('data:image/png;base64,');expect(xml).not.toMatch(/href="https?:/);
      }else{
        const png=PNG.sync.read(bytes);expect(png.width).toBeGreaterThan(500);expect(png.height).toBeGreaterThan(300);
      }
    }
    expect(await page.evaluate(()=>JSON.stringify((window as any).__playground.town))).toBe(original);
    await page.locator('#map').screenshot({path:`artifacts/landmark-images/${info.project.name}-${renderer}.png`});
  }
  expect(errors).toEqual([]);
});

for(const renderer of ['canvas','svg','openfl'])test(`${renderer}: first-use building bitmaps contain visible pixels without an image-loading wait`,async({page})=>{
  await page.goto(`/compare.html?test=1&bench=${renderer}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  const immediate=await page.evaluate(renderer=>{
    const api=(window as any).__comparison;
    api.synthetic({bounds:{minX:-240,minY:-90,maxX:240,maxY:90},background:'#ffffff',hitRegions:[],commands:['church','castle','market'].map((icon,i)=>({kind:'image',icon,label:icon,center:{x:(i-1)*140,y:0},width:96,height:96,color:'#111111',halo:'#ffffff'}))});
    api.resize(480,180,1);api.viewport({centerX:0,centerY:0,zoom:1});
    return renderer==='canvas'?(document.querySelector('#canvas canvas') as HTMLCanvasElement).toDataURL('image/png'):null;
  },renderer);
  let bytes:Buffer;
  if(immediate)bytes=Buffer.from(immediate.slice(immediate.indexOf(',')+1),'base64');
  else{
    // OpenFL presents its graphics on the next frame; SVG already embeds the art.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    bytes=await page.locator(renderer==='svg'?'#svg > svg':'#openfl canvas').screenshot({scale:'css'});
  }
  const png=PNG.sync.read(bytes);expect([png.width,png.height]).toEqual([480,180]);
  for(const cx of [100,240,380]){
    let ink=0;
    for(let y=42;y<138;y++)for(let x=cx-48;x<cx+48;x++){
      const i=(y*png.width+x)*4;if(png.data[i]<235&&png.data[i+1]<235&&png.data[i+2]<235&&png.data[i+3]>0)ink++;
    }
    expect(ink).toBeGreaterThan(50);expect(ink).toBeLessThan(96*96*.9);
  }
});
