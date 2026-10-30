import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { generateTown, serializeTown } from '@settlement/core';
import { buildMapScene, THEMES, landmarkBitmap, pickScene } from '@settlement/map-scene';

const kinds=['church','castle','market'];
const generated=generateTown({seed:12345,size:24,coast:'east',river:true,harbor:true,castle:true,walls:true,plaza:true});
assert(generated.ok);const town=generated.town;

test('building icon sources are distinct transparent raster artwork',()=>{
  const hashes=new Set();
  for(const icon of kinds){
    const bytes=readFileSync(new URL(`../../packages/map-scene/assets/landmarks/${icon}.png`,import.meta.url));
    hashes.add(createHash('sha256').update(bytes).digest('hex'));
    const png=PNG.sync.read(bytes);assert(png.width>=64&&png.height>=64,icon+' has usable source resolution');
    let transparent=0,drawn=0;
    for(let i=0;i<png.data.length;i+=4){if(png.data[i+3]===0)transparent++;if(png.data[i+3]>0)drawn++;}
    assert(transparent>png.width*png.height*.05,icon+' must retain a transparent background');
    assert(drawn>png.width*png.height*.01,icon+' must contain visible artwork');
  }
  assert.equal(hashes.size,kinds.length,'each building type has its own image');
});

test('building bitmaps are ready synchronously with transparent edges and theme-aware ink',()=>{
  for(const icon of kinds){
    const dark=landmarkBitmap(icon,'#20251d','#eee6cf');
    const light=landmarkBitmap(icon,'#f8f8ff','#455b8d');
    for(const bitmap of [dark,light]){
      assert(bitmap.pixels instanceof Uint8ClampedArray);
      assert(bitmap.width>16&&bitmap.height>16);
      assert.equal(bitmap.pixels.length,bitmap.width*bitmap.height*4);
      let transparent=0,visible=0,soft=0;
      for(let i=3;i<bitmap.pixels.length;i+=4){const a=bitmap.pixels[i];if(a===0)transparent++;if(a>0)visible++;if(a>0&&a<255)soft++;}
      assert(transparent>0,icon+' has no opaque rectangular backing');
      assert(visible>bitmap.width*bitmap.height*.01,icon+' must render on its first use');
      assert(soft>0,icon+' retains antialiased image edges');
    }
    assert.notDeepEqual(dark.pixels,light.pixels,'the image adapts to light and dark papers');
    assert.deepEqual(landmarkBitmap(icon,'#20251d','#eee6cf'),dark,'repeat rendering is deterministic');
  }
});

test('a consumer cannot erase the cached building artwork for later previews or exports',()=>{
  const first=landmarkBitmap('church','#20251d','#eee6cf'),expected=new Uint8ClampedArray(first.pixels);
  first.pixels.fill(0);
  const next=landmarkBitmap('church','#20251d','#eee6cf');
  assert.deepEqual(next.pixels,expected);
  assert.notStrictEqual(next.pixels,first.pixels);
});

test('every paper uses image landmarks without changing the saved town or district picking',()=>{
  const original=serializeTown(town),colorways=new Set();let layout;
  for(const [name,palette] of Object.entries(THEMES)){
    const scene=buildMapScene(town,palette),images=scene.commands.filter(command=>command.kind==='image');
    assert.equal(images.length,scene.landmarks.length,name+' has one image per landmark');
    assert.deepEqual(new Set(images.map(image=>image.icon)),new Set(kinds));
    const actualLayout=images.map(({icon,center,width,height})=>({icon,center,width,height}));
    if(layout)assert.deepEqual(actualLayout,layout,'switching paper preserves icon position and size');else layout=actualLayout;
    for(const image of images){
      const marker=scene.landmarks.find(marker=>marker.kind===image.icon&&marker.center.x===image.center.x&&marker.center.y===image.center.y);
      assert(marker);assert(image.width>0&&image.height>0);assert(image.label.length>0);
      assert.match(image.color,/^#[0-9a-f]{6}$/i);assert.match(image.halo,/^#[0-9a-f]{6}$/i);
      colorways.add(image.color+'/'+image.halo);
      assert.equal(pickScene(scene,{centerX:image.center.x,centerY:image.center.y,zoom:1},100,100,50,50),marker.districtId);
    }
    assert.equal(serializeTown(town),original,'image ornament cannot modify exported map data');
  }
  assert(colorways.size>3,'papers retain their own icon colorways');
});
