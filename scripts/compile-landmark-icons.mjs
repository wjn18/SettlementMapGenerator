import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const folder=path.join(root,'packages/map-scene/assets/landmarks'),size=96,padding=5;
const assets={};
for(const icon of ['church','castle','market']){
  const bytes=await fs.readFile(path.join(folder,icon+'.png')),png=PNG.sync.read(bytes);
  let minX=png.width,minY=png.height,maxX=-1,maxY=-1,transparent=0;
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
    const alpha=png.data[(y*png.width+x)*4+3];if(!alpha)transparent++;
    if(alpha>12){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  }
  if(maxX<minX||transparent<png.width*png.height*.05)throw new Error(icon+' must be visible artwork on a transparent background');
  const span=Math.max(maxX-minX+1,maxY-minY+1),scale=span/(size-padding*2);
  const cx=(minX+maxX+1)/2,cy=(minY+maxY+1)/2;
  const alpha=new Uint8Array(size*size),ink=new Uint8Array(size*size);
  // Area-average the source art into an atlas tile; retain transparency and
  // the original pen marks, rather than redrawing their silhouette.
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const x0=cx+(x-size/2)*scale,x1=x0+scale,y0=cy+(y-size/2)*scale,y1=y0+scale;
    let covered=0,dark=0;
    for(let sy=Math.max(0,Math.floor(y0));sy<Math.min(png.height,Math.ceil(y1));sy++)for(let sx=Math.max(0,Math.floor(x0));sx<Math.min(png.width,Math.ceil(x1));sx++){
      const weight=Math.max(0,Math.min(sx+1,x1)-Math.max(sx,x0))*Math.max(0,Math.min(sy+1,y1)-Math.max(sy,y0));
      const index=(sy*png.width+sx)*4,a=png.data[index+3]/255*weight;
      covered+=a;dark+=a*(255-(png.data[index]*.2126+png.data[index+1]*.7152+png.data[index+2]*.0722));
    }
    const index=y*size+x;alpha[index]=Math.round(covered/(scale*scale)*255);ink[index]=covered?Math.round(dark/covered):0;
  }
  assets[icon]={width:size,height:size,sourceSha256:createHash('sha256').update(bytes).digest('hex'),alpha:Buffer.from(alpha).toString('base64'),ink:Buffer.from(ink).toString('base64')};
}
const output=path.join(root,'packages/map-scene/src/landmark-assets.ts');
const text='// Generated from assets/landmarks/*.png by scripts/compile-landmark-icons.mjs.\n// Preserve the original generated PNG artwork and prompts alongside these tiles.\nexport const LANDMARK_MASKS='+JSON.stringify(assets,null,2)+' as const;\n';
if(process.argv.includes('--check')){
  if((await fs.readFile(output,'utf8')).replace(/\r\n/g,'\n')!==text)throw new Error('Landmark tiles are stale; run node scripts/compile-landmark-icons.mjs');
  console.log('Landmark image tiles match all three PNG sources.');
}else{await fs.writeFile(output,text);console.log('Compiled transparent church, castle and market images into synchronous 96px tiles.');}
