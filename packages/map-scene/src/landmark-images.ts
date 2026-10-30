import {LANDMARK_MASKS} from './landmark-assets.js';

export type LandmarkKind=keyof typeof LANDMARK_MASKS;
export interface LandmarkBitmap {width:number;height:number;pixels:Uint8ClampedArray}
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const masks=new Map<LandmarkKind,{width:number;height:number;alpha:Uint8Array;ink:Uint8Array}>();
const colored=new Map<string,LandmarkBitmap>();
function decode(text:string,length:number):Uint8Array {
  const bytes=new Uint8Array(length);let index=0;
  for(let i=0;i<text.length;i+=4){
    const bits=(alphabet.indexOf(text[i])<<18)|(alphabet.indexOf(text[i+1])<<12)|((text[i+2]==='='?0:alphabet.indexOf(text[i+2]))<<6)|(text[i+3]==='='?0:alphabet.indexOf(text[i+3]));
    if(index<length)bytes[index++]=bits>>>16;
    if(index<length)bytes[index++]=bits>>>8;
    if(index<length)bytes[index++]=bits;
  }
  if(index!==length)throw new Error('Invalid landmark image tile');return bytes;
}
function rgb(color:string):number[]{
  if(!/^#[0-9a-f]{6}$/i.test(color))throw new Error('Invalid landmark image color');
  return [1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
}

/** Theme the actual generated artwork synchronously, including its light wash.
 * This avoids image-load races in the first preview and exported PNG/SVG. */
export function landmarkBitmap(icon:LandmarkKind,color:string,halo:string):LandmarkBitmap {
  const key=icon+'/'+color+'/'+halo;let bitmap=colored.get(key);
  if(!bitmap){
    if(!Object.hasOwn(LANDMARK_MASKS,icon))throw new Error('Unknown landmark image');
    let tile=masks.get(icon);
    if(!tile){const asset=LANDMARK_MASKS[icon],length=asset.width*asset.height;tile={width:asset.width,height:asset.height,alpha:decode(asset.alpha,length),ink:decode(asset.ink,length)};masks.set(icon,tile);}
    const dark=rgb(color),light=rgb(halo),pixels=new Uint8ClampedArray(tile.width*tile.height*4);
    for(let i=0;i<tile.alpha.length;i++){
      const amount=tile.ink[i]/255;
      for(let c=0;c<3;c++)pixels[i*4+c]=dark[c]*amount+light[c]*(1-amount);
      pixels[i*4+3]=tile.alpha[i];
    }
    bitmap={width:tile.width,height:tile.height,pixels};
    if(colored.size>=64)colored.delete(colored.keys().next().value!);colored.set(key,bitmap);
  }
  return {...bitmap,pixels:new Uint8ClampedArray(bitmap.pixels)};
}
