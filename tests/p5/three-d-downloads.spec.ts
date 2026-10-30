import {test,expect} from '@playwright/test';

test('3D results offer the selected image without model or technical-data downloads',async({page},info)=>{
  const id='66666666-6666-4666-8666-666666666666',prefix=`/api/3d/jobs/${id}/files/`;
  // Include legacy file links to ensure the UI does not expose old server data.
  const files=Object.fromEntries(['city-center-render.png','scene-render.png','scene.blend','source-town.json','verification.json','asset-integration.json','pipeline-performance.json'].map(name=>[name,prefix+name]));
  const job={id,status:'complete',stage:'已完成',quality:'preview',createdAt:'2026-10-30T08:00:00Z',finishedAt:'2026-10-30T08:01:00Z',seed:7,size:6,buildings:107,sourceHash:'source',assetLibraryUsed:true,files};
  await page.route('**/api/3d/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('.png'))return route.fulfill({contentType:'image/png',headers:url.searchParams.has('download')?{'Content-Disposition':'attachment; filename="scene-render.png"'}:{},body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XnIoAAAAASUVORK5CYII=','base64')});
    return route.fulfill({json:{available:true,activeId:null,jobs:[job]}});
  });
  await page.goto(`/?seed=7&size=6&castle=false&view=3d&job=${id}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  await expect(page.locator('#three-d-image')).toBeVisible();
  const links=page.locator('#three-d-downloads a');await expect(links).toHaveText(['打开原图','下载图片']);
  await expect(links.nth(0)).toHaveAttribute('href',prefix+'city-center-render.png');
  await expect(links.nth(0)).toHaveAttribute('rel','noopener');
  await expect(links.nth(1)).toHaveAttribute('href',new RegExp(prefix+'city-center-render\\.png\\?download=1$'));
  await page.locator('#three-d-framing').selectOption('full');
  await expect(links.nth(1)).toHaveAttribute('href',new RegExp(prefix+'scene-render\\.png\\?download=1$'));
  const pending=page.waitForEvent('download');await links.nth(1).click();
  expect((await pending).suggestedFilename()).toBe('scene-render.png');
  await expect(page.locator('#three-d-footnote')).toContainText('可下载当前取景的图片');
  await expect(page.locator('#three-d-panel')).not.toContainText('下载 Blender');
  await expect(page.locator('#export')).toBeEnabled();
  await page.screenshot({path:`artifacts/image-only-downloads/${info.project.name}.png`});
});
