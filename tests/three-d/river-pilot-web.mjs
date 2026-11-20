import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { generateTown, serializeTown } from '@settlement/core';

const base = process.argv[2] ?? 'http://127.0.0.1:4186';
const output = resolve('artifacts/river-pilot');
await mkdir(output, {recursive: true});
const browser = await chromium.launch({channel: 'chrome'});
const errors = [], apiRequests = [];
async function watch(page) {
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {if(msg.type()==='error' && /shader|WebGLProgram|THREE\./i.test(msg.text())) errors.push(msg.text());});
  await page.route('**/api/3d/**', route => { apiRequests.push(route.request().url()); return route.abort(); });
}
// Compare rendered pixels, including real pointer input. A blank WebGL canvas must fail.
function changed(left, right) {
  const a = PNG.sync.read(left), b = PNG.sync.read(right);
  assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  let different = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if ([0, 1, 2].some(c => Math.abs(a.data[i + c] - b.data[i + c]) > 10)) different++;
  }
  return different / (a.width * a.height);
}
// Measure the orthographic field actually sent to WebGL, independently of the selected preset.
async function visibleShortSide(canvas) {
  return canvas.evaluate(async element => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const gl = element.getContext('webgl2'), program = gl.getParameter(gl.CURRENT_PROGRAM);
    const projection = gl.getUniform(program, gl.getUniformLocation(program, 'projectionMatrix'));
    return Math.min(2 / projection[0], 2 / projection[5]);
  });
}
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  await watch(page);
  await page.goto(base + '/river.html');
  await page.locator('#river-app[data-ready="true"]').waitFor();
  await page.locator('[data-ui=image]').evaluate(img => img.decode());
  assert.match(await page.locator('[data-ui=stats]').innerText(), /170 栋建筑.*58 条道路.*1 座桥/);
  await page.screenshot({path: resolve(output, 'comparison.png')});
  const canvas = page.locator('.river-frame canvas');
  const box = await canvas.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
  const original = await canvas.screenshot();
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 120, y + 30, {steps: 10}); await page.mouse.up();
  const rotated = await canvas.screenshot();
  const dragDifference = changed(original, rotated); assert.ok(dragDifference > .04);
  await page.mouse.wheel(0, -320); await page.waitForTimeout(160);
  const zoomDifference = changed(rotated, await canvas.screenshot()); assert.ok(zoomDifference > .04);
  await page.getByRole('button', {name: '初始机位'}).click();
  assert.ok(changed(original, await canvas.screenshot()) < .025);
  await page.getByRole('button', {name: '桥头', exact: true}).click();
  await canvas.screenshot({path: resolve(output, 'bridge.png')});
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', {name: '导出 PNG'}).click();
  const download = await downloadEvent; assert.equal(download.suggestedFilename(), 'river-7-1500.png');
  const exported = PNG.sync.read(await readFile(await download.path()));
  assert.deepEqual([exported.width, exported.height], [1500, 1500]);
  const colors = new Set();
  for (let i = 0; i < exported.data.length; i += 400) colors.add(exported.data.readUInt32BE(i));
  assert.ok(colors.size > 100);
  await page.getByRole('button', {name: '返回地图工坊'}).click();
  await page.locator('body[data-ready=true]').waitFor();
  assert.equal(await page.locator('#map-building-count').innerText(), '170');
  await page.getByRole('button', {name: '三维效果', exact:true}).click();
  const live = page.locator('#live-town'), panel = page.locator('#live-controls');
  await page.locator('#live-town[data-details=ready]').waitFor();
  assert.equal(new URL(page.url()).pathname, '/');
  assert.ok(await page.locator('#task-three-d').getAttribute('aria-selected') === 'true');
  assert.ok(await panel.locator('[data-ui=compare]').isEnabled());
  assert.ok(await panel.locator('[data-frame=gate]').isHidden());
  assert.equal(await live.locator('[data-ui=source]').count(),0);
  await panel.locator('[data-frame=street]').click();
  const framed=await live.locator('canvas').screenshot();
  await page.locator('#view-plan').click();
  await page.locator('#seed').fill('901');
  await page.locator('#task-three-d').click();
  assert.ok(changed(framed,await live.locator('canvas').screenshot())<.025);
  assert.match(await live.locator('[data-ui=stats]').innerText(),/170 栋建筑/);
  await page.locator('#task-files').click();
  const input = process.argv[3] ? await readFile(process.argv[3], 'utf8') : serializeTown(generateTown({seed:7,size:12,river:true,coast:false,walls:true,castle:true}).town);
  const town = JSON.parse(input);
  await page.locator('#file').setInputFiles({name:'saved.json',mimeType:'application/json',buffer:Buffer.from(input)});
  await page.waitForFunction(n => document.querySelector('#map-building-count').textContent === String(n), town.buildings.length);
  await page.locator('#view-three-d').click();
  await page.locator('#live-town[data-details=ready]').waitFor();
  assert.match(await live.locator('[data-ui=stats]').innerText(), new RegExp(town.buildings.length + ' 栋建筑'));
  assert.ok(await panel.locator('[data-ui=compare]').isHidden());
  const townCanvas = live.locator('canvas');
  const overview = await visibleShortSide(townCanvas);
  if (town.gates.length) {
    assert.match(await live.locator('[data-ui=stats]').innerText(), new RegExp(town.gates.length + ' 座城门'));
    await panel.getByRole('button', {name:'城门',exact:true}).click();
    assert.ok(await visibleShortSide(townCanvas) < overview / 3);
  }
  await panel.locator('[data-frame=street]').click();
  const street = await visibleShortSide(townCanvas);
  assert.ok(street < overview / 3, 'workshop opens at city scale');
  await townCanvas.hover();
  await page.mouse.wheel(0, 30000);
  const landscape = await visibleShortSide(townCanvas);
  assert.ok(landscape > overview, 'wheel can travel beyond the entire city from a house');
  await panel.locator('[data-frame=full]').click();
  for (let i = 0; i < 45; i++) await townCanvas.press('-');
  assert.ok(Math.abs(await visibleShortSide(townCanvas) / landscape - 1) < .001, 'keyboard and wheel reach the same map-wide limit');
  await panel.locator('[data-frame=full]').click();
  assert.ok(Math.abs(await visibleShortSide(townCanvas) / overview - 1) < .001, 'full view restores the initial framing');
  const integratedDownload=page.waitForEvent('download');
  await panel.locator('[data-ui=save]').click();
  assert.equal((await integratedDownload).suggestedFilename(),'town-3d-'+town.resolved.seed+'-1500.png');
  await page.locator('#task-generate').click();
  await page.locator('#seed').fill('42');
  await page.locator('#size').selectOption('6');
  await page.locator('#generate').click();
  await page.locator('#view-three-d').click();
  await page.waitForURL(url=>url.searchParams.get('seed')==='42' && url.searchParams.get('view')==='3d');
  await page.locator('#live-town[data-details=ready]').waitFor();
  assert.equal(await live.locator('canvas').count(),1);
  const buildingCount=await page.locator('#map-building-count').textContent();
  assert.match(await live.locator('[data-ui=stats]').innerText(),new RegExp(buildingCount+' 栋建筑'));
  await page.reload();
  await page.locator('#live-town[data-details=ready]').waitFor();
  assert.match(await live.locator('[data-ui=stats]').innerText(),new RegExp(buildingCount+' 栋建筑'));
  await page.screenshot({path:resolve(output,'workshop.png')});
  // Measure the loaded GLBs in world space. These two trees previously stood 57.9 m and 25.5 m tall.
  await page.addInitScript(() => {
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe', ({detail}) => {
      if (detail.isScene) window.inspectedTown = detail;
    });
  });
  await page.goto(base + '/?seed=7&size=12&river=true&coast=false&walls=true&castle=false&plaza=true&view=3d');
  await page.locator('#live-town[data-details=ready]').waitFor();
  const oakHeights = await page.evaluate(() => {
    const scene = window.inspectedTown;
    scene.updateMatrixWorld(true);
    return scene.getObjectsByProperty('name','tree_oak_01__ROOT').map(oak => {
      const mesh = oak.getObjectByProperty('isMesh',true);
      const bounds = mesh.geometry.boundingBox.clone().setFromObject(oak,true);
      return (bounds.max.y - bounds.min.y) / .5;
    });
  });
  assert.equal(oakHeights.length,2);
  assert.ok(oakHeights.every(h => h >= 7.6 - .001 && h <= 13 + .001), 'seed 7 oak heights in map metres: ' + oakHeights);
  await page.close();

  const details=await browser.newPage({viewport:{width:1440,height:900}});
  await watch(details);
  for(const [sample,focus] of [['sample','street'],['sample','church'],['sample','market'],['river-port','castle'],['river-port','gate'],['estuary','harbor']]){
    await details.goto(base+'/river.html?sample='+sample+'&focus='+focus);
    await details.locator('#river-app[data-details=ready]').waitFor();
    assert.ok(await details.locator('[data-ui=reference]').isHidden());
    assert.ok(await details.locator('[data-frame='+focus+']').isVisible());
    const c=details.locator('.river-frame canvas');
    const near=await c.screenshot();
    await details.screenshot({path:resolve(output,'detail-'+focus+'.png')});
    if(focus==='street'){
      const box=await c.boundingBox();
      await c.dblclick({position:{x:box.width*.22,y:box.height*.66}});
      assert.ok(changed(near,await c.screenshot())>.10,'double-click frames a different street house');
    }
    await details.locator('[data-frame=full]').click();
    assert.ok(changed(near,await c.screenshot())>.20,focus+' changes rendered pixels');
  }
  await details.locator('[data-ui=compare]').click();
  await details.locator('[data-ui=image]').evaluate(img=>img.decode());
  assert.match(await details.locator('[data-ui=image]').getAttribute('src'),/estuary-reference/);
  await details.locator('[data-ui=size]').selectOption('3200');
  await details.locator('[data-frame=harbor]').click();
  const large=details.waitForEvent('download');
  await details.locator('[data-ui=save]').click();
  const file=await large;
  const hd=PNG.sync.read(await readFile(await file.path()));
  assert.equal(file.suggestedFilename(),'river-7-3200.png');assert.deepEqual([hd.width,hd.height],[3200,3200]);
  await details.locator('[data-ui=back]').click();
  await details.locator('body[data-ready=true]').waitFor();
  assert.equal(await details.locator('#map-building-count').innerText(),'433');
  await details.close();

  const mobile = await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,hasTouch:true,isMobile:true});
  await watch(mobile);
  await mobile.goto(base + '/river.html'); await mobile.locator('#river-app[data-ready=true]').waitFor();
  assert.ok(await mobile.locator('[data-ui=reference]').isHidden());
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const touchCanvas = mobile.locator('.river-frame canvas');
  const touchStart = await touchCanvas.screenshot();
  const cdp = await mobile.context().newCDPSession(mobile);
  await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:140,y:390}]});
  for (const x of [150, 170, 200, 240]) await cdp.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x,y:400}]});
  await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
  const afterSwipe = await touchCanvas.screenshot();
  assert.ok(changed(touchStart, afterSwipe) > .04);
  const contacts = (gap) => [{x:190-gap,y:400,id:1},{x:190+gap,y:400,id:2}];
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:contacts(30)});
  for (const gap of [40, 50, 60, 70]) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:contacts(gap)});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok(changed(afterSwipe, await touchCanvas.screenshot()) > .04);
  const toggle = await mobile.getByRole('button',{name:'对照样片'}).boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:toggle.x+toggle.width/2,y:toggle.y+toggle.height/2,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await mobile.locator('[data-ui=reference]:visible img[src]').waitFor();
  await mobile.locator('[data-ui=image]').evaluate(img => img.decode());
  await mobile.screenshot({path:resolve(output,'mobile.png')});
  assert.deepEqual(errors, []); assert.deepEqual(apiRequests, []);
  const report = {sampleBuildings:170, sampleRoads:58, importedBuildings:town.buildings.length, importedGates:town.gates.length,
    dragDifference, zoomDifference, export:[exported.width,exported.height], highResolution:[hd.width,hd.height],
    closeViews:['street','church','market','castle','gate','harbor'],buildingPick:true,mobileTouch:true,apiRequests,errors};
  await writeFile(resolve(output,'browser.json'), JSON.stringify(report,null,2)); console.log(report);
} finally { await browser.close(); }
