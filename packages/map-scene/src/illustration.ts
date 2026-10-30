import type { TownData, Point2, Bounds } from '@settlement/core';
import type { DrawCommand, Stroke } from './index.js';
import { mixColor, waterColor as themeWaterColor } from './themes.js';
import type { MapTheme } from './themes.js';
import type { LandmarkKind } from './landmark-images.js';

export interface Landmark {
  districtId: string; kind: LandmarkKind; center: Point2; radius: number; label: string;
}
export interface PaperTexture { seed: number; color: string }
/** A small repeating paper tile; identical bytes in every browser renderer. */
export function paperTexturePixels(texture:PaperTexture,size=128):Uint8ClampedArray {
  const rng=random(texture.seed,'paper-grain'),pixels=new Uint8ClampedArray(size*size*4);
  const rgb=[1,3,5].map(i=>parseInt(texture.color.slice(i,i+2),16));
  const coarse=Array.from({length:64},()=>rng()-.5),sample=(x:number,y:number)=>coarse[(y%8)*8+x%8];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/size*8,v=y/size*8,ix=Math.floor(u),iy=Math.floor(v),fx=u-ix,fy=v-iy;
    const mottle=(sample(ix,iy)*(1-fx)+sample(ix+1,iy)*fx)*(1-fy)+(sample(ix,iy+1)*(1-fx)+sample(ix+1,iy+1)*fx)*fy;
    const grain=(rng()-.5)*17,micro=Math.sin(x*1.7+y*.32)*1.4+Math.sin(y*2.2+x*.4)*1.1;
    const tone=grain+mottle*12+micro-(rng()>.997?18:0),offset=(y*size+x)*4;
    for(let c=0;c<3;c++)pixels[offset+c]=rgb[c]+tone;
    pixels[offset+3]=255;
  }return pixels;
}
export interface Illustration {
  paper: DrawCommand[]; fields: DrawCommand[]; water: DrawCommand[];
  roofs: DrawCommand[]; trees: DrawCommand[]; harbor: DrawCommand[]; symbols: DrawCommand[];
  landmarks: Landmark[];
  details: { trees: number; fields: number; waves: number; boats: number; piers: number };
}

const TAU=Math.PI*2;
const lerp=(a:Point2,b:Point2,t:number):Point2=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const distance=(a:Point2,b:Point2)=>Math.hypot(a.x-b.x,a.y-b.y);
function random(seed:number,key:string):()=>number {
  let state=seed|0;for(let i=0;i<key.length;i++)state=Math.imul(state^key.charCodeAt(i),16777619);
  return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
}
function bounds(ring:readonly Point2[]):Bounds {
  return {minX:Math.min(...ring.map(p=>p.x)),maxX:Math.max(...ring.map(p=>p.x)),minY:Math.min(...ring.map(p=>p.y)),maxY:Math.max(...ring.map(p=>p.y))};
}
function inside(ring:readonly Point2[],p:Point2):boolean {
  let hit=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;
  }return hit;
}
function center(ring:readonly Point2[]):Point2 {
  let area=0,x=0,y=0;
  for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],c=a.x*b.y-b.x*a.y;area+=c;x+=(a.x+b.x)*c;y+=(a.y+b.y)*c;}
  return Math.abs(area)>1e-8?{x:x/(3*area),y:y/(3*area)}:ring[0];
}
function area(ring:readonly Point2[]):number {return Math.abs(ring.reduce((n,a,i)=>{const b=ring[(i+1)%ring.length];return n+a.x*b.y-b.x*a.y;},0)/2);}
function segmentDistance(p:Point2,a:Point2,b:Point2):number {
  const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
  return distance(p,{x:a.x+dx*t,y:a.y+dy*t});
}
class Grid<T> {
  cells=new Map<string,T[]>();
  constructor(readonly step:number){}
  add(box:Bounds,value:T):void {
    for(let x=Math.floor(box.minX/this.step);x<=Math.floor(box.maxX/this.step);x++)for(let y=Math.floor(box.minY/this.step);y<=Math.floor(box.maxY/this.step);y++){
      const key=x+','+y,list=this.cells.get(key);if(list)list.push(value);else this.cells.set(key,[value]);
    }
  }
  near(p:Point2,r=0):T[]{
    const found=new Set<T>();
    for(let x=Math.floor((p.x-r)/this.step);x<=Math.floor((p.x+r)/this.step);x++)for(let y=Math.floor((p.y-r)/this.step);y<=Math.floor((p.y+r)/this.step);y++)for(const item of this.cells.get(x+','+y)??[])found.add(item);
    return [...found];
  }
}

/** Deterministic vector ornament: the source planning geometry is never changed. */
export function createIllustration(town:TownData,palette:MapTheme):Illustration {
  const result:Illustration={paper:[],fields:[],water:[],roofs:[],trees:[],harbor:[],symbols:[],landmarks:[],details:{trees:0,fields:0,waves:0,boats:0,piers:0}};
  const unit=Number(town.generatorVersion.match(/^0\.(\d+)\./)?.[1]??0)>=8?4:1;
  const seed=town.resolved.seed,vertices=new Map(town.vertices.map(v=>[v.id,v]));
  const ring=(ids:string[])=>ids.map(id=>({...vertices.get(id)!}));
  const city=town.districts.filter(d=>d.withinCity).flatMap(d=>ring(d.boundary));
  const cityBounds=bounds(city.length?city:town.vertices),span=Math.max(cityBounds.maxX-cityBounds.minX,cityBounds.maxY-cityBounds.minY,40*unit);
  const extent={minX:cityBounds.minX-span*.55,maxX:cityBounds.maxX+span*.55,minY:cityBounds.minY-span*.55,maxY:cityBounds.maxY+span*.55};
  const inExtent=(p:Point2)=>p.x>=extent.minX&&p.x<=extent.maxX&&p.y>=extent.minY&&p.y<=extent.maxY;
  const stroke=(color:string,width:number):Stroke=>({color,width,units:'world',cap:'round',join:'round',miterLimit:3});
  const line=(layer:DrawCommand[],points:Point2[],color:string,width:number)=>{if(points.length>1)layer.push({kind:'polyline',points,stroke:stroke(color,width)});};
  const polygon=(layer:DrawCommand[],points:Point2[],fill:string,outline?:string,width=unit*.16)=>layer.push({kind:'polygon',points,fill,...(outline?{stroke:stroke(outline,width)}:{})});
  const circle=(layer:DrawCommand[],p:Point2,r:number,fill:string)=>layer.push({kind:'circle',center:p,radius:r,fill});
  const river=town.river,coast=town.terrain?.coast;
  const riverAt=(p:Point2)=>!!river&&(river.surface?inside(river.surface,p):river.centerline.slice(1).some((b,i)=>segmentDistance(p,river.centerline[i],b)<river.width/2));
  const waterAt=(p:Point2)=>!!coast&&inside(coast.water,p)||riverAt(p);
  const validLine=(layer:DrawCommand[],points:Point2[],color:string,width:number,accept:(p:Point2)=>boolean):void=>{
    let run:Point2[]=[];
    for(const p of points){if(accept(p)&&(!run.length||accept(lerp(run.at(-1)!,p,.5))))run.push(p);else{line(layer,run,color,width);run=[];}}
    line(layer,run,color,width);
  };
  const hatch=(shape:Point2[],angle:number,gap:number,draw:(a:Point2,b:Point2,index:number)=>void):void=>{
    const u={x:Math.cos(angle),y:Math.sin(angle)},v={x:-u.y,y:u.x};
    const projected=shape.map(p=>({x:p.x*u.x+p.y*u.y,y:p.x*v.x+p.y*v.y}));
    const lo=Math.min(...projected.map(p=>p.y)),hi=Math.max(...projected.map(p=>p.y));let index=0;
    for(let y=lo+gap*.7;y<hi-gap*.35&&index<80;y+=gap,index++){
      const cuts:number[]=[];
      for(let i=0;i<projected.length;i++){
        const a=projected[i],b=projected[(i+1)%projected.length];
        if((a.y>y)!==(b.y>y))cuts.push(a.x+(b.x-a.x)*(y-a.y)/(b.y-a.y));
      }
      cuts.sort((a,b)=>a-b);
      for(let i=1;i<cuts.length;i+=2){const a=cuts[i-1]+unit*.5,b=cuts[i]-unit*.5;if(b-a>unit)draw({x:u.x*a+v.x*y,y:u.y*a+v.y*y},{x:u.x*b+v.x*y,y:u.y*b+v.y*y},index);}
    }
  };

  // Sparse pen flecks complement the shared paper texture without heavy SVGs.
  const paperRandom=random(seed,'paper');
  for(let i=0;i<50;i++){
    const p={x:extent.minX+paperRandom()*(extent.maxX-extent.minX),y:extent.minY+paperRandom()*(extent.maxY-extent.minY)},r=(4+paperRandom()*14)*unit;
    polygon(result.paper,Array.from({length:16},(_,j)=>{const a=j*TAU/16,k=r*(.85+paperRandom()*.25);return{x:p.x+Math.cos(a)*k,y:p.y+Math.sin(a)*k};}),mixColor(palette.paper,paperRandom()<.55?palette.dark:palette.light,.005+paperRandom()*.009));
  }
  for(let i=0;i<400;i++){
    const p={x:extent.minX+paperRandom()*(extent.maxX-extent.minX),y:extent.minY+paperRandom()*(extent.maxY-extent.minY)};
    const color=mixColor(palette.paper,paperRandom()<.8?palette.dark:palette.light,.055+paperRandom()*.07);
    if(i%3===0)line(result.paper,[p,{x:p.x+(paperRandom()*1.2+.2)*unit,y:p.y+(paperRandom()-.5)*unit*.35}],color,unit*.055);
    else circle(result.paper,p,unit*(.035+paperRandom()*.085),color);
  }

  const roads=new Grid<{a:Point2;b:Point2;width:number}>(unit*16),buildings=new Grid<Point2[]>(unit*16),districts=new Grid<{shape:Point2[];urban:boolean;park:boolean}>(unit*24);
  for(const road of town.roads){const path=ring(road.vertexIds);for(let i=1;i<path.length;i++){const item={a:path[i-1],b:path[i],width:road.width},box=bounds([item.a,item.b]);roads.add({minX:box.minX-road.width,maxX:box.maxX+road.width,minY:box.minY-road.width,maxY:box.maxY+road.width},item);}}
  for(const building of town.buildings){const shape=ring(building.boundary);buildings.add(bounds(shape),shape);}
  for(const d of town.districts){const shape=ring(d.boundary);districts.add(bounds(shape),{shape,urban:d.withinCity,park:d.wardType==='Park'});}
  const nearRoad=(p:Point2,r:number)=>roads.near(p,r).some(road=>segmentDistance(p,road.a,road.b)<road.width/2+r);
  const nearBuilding=(p:Point2,r:number)=>buildings.near(p,r).some(shape=>inside(shape,p)||shape.some((a,i)=>segmentDistance(p,a,shape[(i+1)%shape.length])<r));
  const fields:Point2[][]=[];
  const rural=town.districts.filter(d=>!d.withinCity&&['Farm','Ward'].includes(d.wardType)).map(d=>({d,shape:ring(d.boundary)})).filter(item=>inExtent(center(item.shape))).sort((a,b)=>distance(center(a.shape),town.center)-distance(center(b.shape),town.center));
  for(const {d,shape} of rural){
    if(result.details.fields>=22)break;
    const rng=random(seed,d.id+'/field');if(d.wardType!=='Farm'&&rng()>.48)continue;
    const c=center(shape),field=shape.map(p=>lerp(c,p,.66+rng()*.07));
    if(area(field)<unit*unit*55||!field.every(p=>inside(shape,p)&&!waterAt(p)))continue;
    fields.push(field);result.details.fields++;
    polygon(result.fields,field,mixColor(palette.paper,palette.green??palette.medium,.25+rng()*.13));
    const longest=shape.reduce((best,a,i)=>distance(a,shape[(i+1)%shape.length])>distance(shape[best],shape[(best+1)%shape.length])?i:best,0);
    const a=shape[longest],b=shape[(longest+1)%shape.length],angle=Math.atan2(b.y-a.y,b.x-a.x);
    hatch(field,angle,unit*1.1,(a,b,i)=>line(result.fields,[a,lerp(a,b,.5),b],mixColor(palette.paper,palette.dark,i%4===0?.28:.2),unit*(i%4===0?.12:.085)));
    const inset=field.map(p=>lerp(c,p,.91));line(result.fields,[...inset,inset[0]],mixColor(palette.paper,palette.dark,.16),unit*.1);
  }

  // Shore contours stop at the river mouth; little wavelets are clipped to water.
  const waterColor=themeWaterColor(palette);
  const waterContrast=Math.hypot(...[1,3,5].map(i=>parseInt(waterColor.slice(i,i+2),16)-parseInt(palette.light.slice(i,i+2),16)));
  const waterInk=waterContrast<80?palette.dark:palette.light;
  const contours=(path:Point2[],closed:boolean,sea:boolean):void=>{
    const points=closed?[...path,path[0]]:path;
    for(const band of [1.1,2.5,4.4]){
      const samples:Point2[]=[];
      for(let i=1;i<points.length;i++){
        const a=points[i-1],b=points[i],length=distance(a,b);if(!length)continue;
        const normal={x:-(b.y-a.y)/length,y:(b.x-a.x)/length},middle=lerp(a,b,.5);
        const sign=waterAt({x:middle.x+normal.x*unit*.3,y:middle.y+normal.y*unit*.3})?1:-1;
        const count=Math.max(1,Math.min(300,Math.ceil(length/(unit*2))));
        for(let j=0;j<count;j++){const p=lerp(a,b,j/count),wiggle=Math.sin((p.x+p.y)*.09/unit+band)*unit*.12,offset=band*unit+wiggle;samples.push({x:p.x+normal.x*offset*sign,y:p.y+normal.y*offset*sign});}
      }
      validLine(result.water,samples,mixColor(waterColor,waterInk,.35),unit*.11,p=>inExtent(p)&&waterAt(p)&&(sea?!riverAt(p):!coast||!inside(coast.water,p)));
    }
  };
  if(coast)contours(coast.shoreline,false,true);
  if(river?.surface)contours(river.surface,true,false);
  if(coast||river){
    const rng=random(seed,'water-waves'),gap=Math.max(unit*6,span/45);
    for(let y=extent.minY;y<extent.maxY;y+=gap)for(let x=extent.minX;x<extent.maxX;x+=gap*1.65){
      const c={x:x+(rng()-.5)*gap,y:y+(rng()-.5)*gap},length=unit*(3.5+rng()*4.5);if(!waterAt(c))continue;
      let angle=0;
      if(riverAt(c)&&river){let best=Infinity;for(let i=1;i<river.centerline.length;i++){const a=river.centerline[i-1],b=river.centerline[i],d=segmentDistance(c,a,b);if(d<best){best=d;angle=Math.atan2(b.y-a.y,b.x-a.x);}}}
      const phase=rng()*TAU,points=Array.from({length:9},(_,i)=>{const t=i/8-.5,offset=Math.sin(i/8*TAU+phase)*unit*.5;return{x:c.x+Math.cos(angle)*t*length-Math.sin(angle)*offset,y:c.y+Math.sin(angle)*t*length+Math.cos(angle)*offset};});
      if(points.every(waterAt)&&points.slice(1).every((p,i)=>waterAt(lerp(points[i],p,.5)))){line(result.water,points,mixColor(waterColor,waterInk,.36+rng()*.14),unit*.16);result.details.waves++;}
    }
  }

  // Roof ridges suggest pen-drawn volumes without adding geometry to TownData.
  for(const b of town.buildings){
    const shape=ring(b.boundary),rng=random(seed,b.id+'/roof');if(area(shape)<unit*unit*12||rng()>.56)continue;
    let edge=0;shape.forEach((a,i)=>{if(distance(a,shape[(i+1)%shape.length])>distance(shape[edge],shape[(edge+1)%shape.length]))edge=i;});
    const a=shape[edge],b1=shape[(edge+1)%shape.length],angle=Math.atan2(b1.y-a.y,b1.x-a.x),c=center(shape),u={x:Math.cos(angle),y:Math.sin(angle)};
    // One clipped central ridge is quieter than filling every roof with hatching.
    const crossings:number[]=[];
    for(let i=0;i<shape.length;i++){
      const a=shape[i],b=shape[(i+1)%shape.length],ay=(a.x-c.x)*-u.y+(a.y-c.y)*u.x,by=(b.x-c.x)*-u.y+(b.y-c.y)*u.x;
      if((ay>0)!==(by>0)){const p=lerp(a,b,-ay/(by-ay));crossings.push((p.x-c.x)*u.x+(p.y-c.y)*u.y);}
    }
    crossings.sort((a,b)=>a-b);
    for(let i=1;i<crossings.length;i+=2){const lo=crossings[i-1],hi=crossings[i];if(hi-lo>unit*2){const from={x:c.x+u.x*(lo+(hi-lo)*.18),y:c.y+u.y*(lo+(hi-lo)*.18)},to={x:c.x+u.x*(hi-(hi-lo)*.18),y:c.y+u.y*(hi-(hi-lo)*.18)};line(result.roofs,[from,to],mixColor(palette.roof??palette.light,palette.dark,.5),unit*.105);}}
  }

  const treeRandom=random(seed,'countryside-trees'),placed=new Grid<{p:Point2;r:number}>(unit*10);
  const target=Math.min(600,240+town.request.size*8);
  for(let i=0;i<12000&&result.details.trees<target;i++){
    const p={x:extent.minX+treeRandom()*(extent.maxX-extent.minX),y:extent.minY+treeRandom()*(extent.maxY-extent.minY)},r=unit*(1.25+treeRandom()*1.15);
    // Cluster woods in loose stands, keeping cultivated plots and roads legible.
    if(Math.sin(p.x/span*19+seed)+Math.cos(p.y/span*17-seed)<-.25)continue;
    const clearance=r*1.2+unit*.8;
    if([p,...Array.from({length:16},(_,j)=>({x:p.x+Math.cos(j*TAU/16)*clearance,y:p.y+Math.sin(j*TAU/16)*clearance}))].some(waterAt))continue;
    if(districts.near(p,r).some(d=>d.urban&&!d.park&&inside(d.shape,p))||nearRoad(p,clearance)||nearBuilding(p,clearance))continue;
    if(fields.some(field=>inside(field,p))||placed.near(p,r*2).some(q=>distance(p,q.p)<r+q.r+unit*.3))continue;
    placed.add({minX:p.x-r,maxX:p.x+r,minY:p.y-r,maxY:p.y+r},{p,r});result.details.trees++;
    const color=mixColor(palette.tree??palette.medium,palette.paper,.17+treeRandom()*.27),outline=mixColor(color,palette.dark,.55);
    const phase=treeRandom()*TAU,crown=Array.from({length:32},(_,j)=>{const a=j*TAU/32,k=r*(.94+.075*Math.sin(a*5+phase)+treeRandom()*.045);return{x:p.x+Math.cos(a)*k,y:p.y+Math.sin(a)*k*.91};});
    polygon(result.trees,crown.map(q=>({x:q.x+unit*.4,y:q.y+unit*.55})),mixColor(palette.paper,palette.dark,.12));
    polygon(result.trees,crown,color,outline,unit*.16);
    for(let j=0;j<3;j++){
      const a=j*TAU/3+.5,c={x:p.x+Math.cos(a)*r*.39,y:p.y+Math.sin(a)*r*.39},arc=Array.from({length:8},(_,k)=>{const t=k/7*4.1;return{x:c.x+Math.cos(t)*r*.42,y:c.y+Math.sin(t)*r*.42};});
      line(result.trees,arc,mixColor(color,palette.dark,.42),unit*.11);
    }
    line(result.trees,[{x:p.x-r*.35,y:p.y+r*.13},p,{x:p.x+r*.16,y:p.y-r*.4}],outline,unit*.095);
  }

  const wood=palette.mutedColors?mixColor(palette.roof??palette.light,'#b1966b',.45):palette.roof??palette.light,woodInk=mixColor(wood,palette.dark,.58),boats:{p:Point2;r:number}[]=[];
  const boat=(p:Point2,heading:number,length:number,beam:number,sail:boolean):void=>{
    const u={x:Math.cos(heading),y:Math.sin(heading)},at=(x:number,y:number)=>({x:p.x+u.x*x-u.y*y,y:p.y+u.y*x+u.x*y});
    const hull=[[-.5,0],[-.39,-.36],[-.12,-.49],[.25,-.43],[.46,-.18],[.5,0],[.46,.18],[.25,.43],[-.12,.49],[-.39,.36]];
    const footprint=hull.map(([x,y])=>at(x*length,y*beam));
    if(!footprint.every(waterAt)||!footprint.every((p,i)=>waterAt(lerp(p,footprint[(i+1)%footprint.length],.5))))return;
    polygon(result.harbor,footprint,wood,woodInk,unit*.16);
    polygon(result.harbor,hull.map(([x,y])=>at(x*length*.76,y*beam*.69)),mixColor(wood,palette.dark,.15),woodInk,unit*.09);
    for(let x=-.25;x<=.3;x+=.14)line(result.harbor,[at(x*length,-beam*.29),at(x*length,beam*.29)],mixColor(wood,palette.light,.4),unit*.09);
    line(result.harbor,[at(-length*.38,0),at(length*.4,0)],woodInk,unit*.11);
    if(sail){line(result.harbor,[at(0,-beam*.6),at(0,beam*.6)],woodInk,unit*.14);polygon(result.harbor,[at(-length*.04,-beam*.45),at(length*.24,beam*.18),at(-length*.04,beam*.38)],palette.light,woodInk,unit*.1);}
    boats.push({p,r:length*.55});result.details.boats++;
  };
  for(const dock of town.terrain?.docks??[]){
    if(dock.riverHarbor)polygon(result.harbor,dock.riverHarbor.yard.map(p=>({...p})),palette.road??palette.light);
    result.details.piers++;
    for(let i=1;i<dock.points.length;i++){
      const a=dock.points[i-1],b=dock.points[i],length=distance(a,b);if(!length)continue;
      const n={x:-(b.y-a.y)/length,y:(b.x-a.x)/length},half=dock.width/2;
      const at=(t:number,w:number)=>({x:a.x+(b.x-a.x)*t+n.x*w,y:a.y+(b.y-a.y)*t+n.y*w});
      polygon(result.harbor,[at(0,-half),at(1,-half),at(1,half),at(0,half)],wood,woodInk,unit*.17);
      const count=Math.min(100,Math.max(2,Math.floor(length/(unit*.65))));
      for(let j=1;j<count;j++){line(result.harbor,[at(j/count,-half*.94),at(j/count,half*.94)],mixColor(wood,woodInk,.45),unit*.075);if(j%5===0)for(const side of [-1,1])circle(result.harbor,at(j/count,half*side),unit*.18,woodInk);}
    }
    if(dock.riverHarbor){const b=dock.riverHarbor.berth;boat(b.center,b.heading,b.length,b.beam,b.boat.startsWith('cargo-'));continue;}
    const a=dock.points.at(-2),b=dock.points.at(-1);if(!a||!b)continue;
    const rng=random(seed,dock.id+'/boats'),d=distance(a,b);if(!d)continue;
    const u={x:(b.x-a.x)/d,y:(b.y-a.y)/d};
    for(const side of [-1,1]){
      const length=unit*(6.5+rng()*3),beam=length*.27,t=.48+rng()*.45,offset=dock.width/2+beam*.8+unit;
      const p={x:a.x+(b.x-a.x)*t-u.y*offset*side,y:a.y+(b.y-a.y)*t+u.x*offset*side};
      const hull=[-.45,0,.45].flatMap(x=>[-.5,.5].map(y=>({x:p.x+u.x*x*length-u.y*y*beam,y:p.y+u.y*x*length+u.x*y*beam})));
      if(hull.every(waterAt)&&!nearRoad(p,beam*.6)&&!boats.some(b=>distance(b.p,p)<b.r+length*.5))boat(p,Math.atan2(u.y,u.x),length,beam,rng()>.55);
    }
  }

  for(const district of town.districts.filter(d=>['Cathedral','Castle','Market'].includes(d.wardType))){
    const source=town.buildings.filter(b=>b.districtId===district.id).sort((a,b)=>area(ring(b.boundary))-area(ring(a.boundary)))[0];
    const shape=source?ring(source.boundary):ring(district.boundary),p=center(shape);
    if(!inside(shape,p)||waterAt(p))continue;
    const r=Math.min(unit*3,Math.sqrt(area(shape))*.2);if(r<unit*.7)continue;
    const kind=district.wardType==='Cathedral'?'church':district.wardType==='Castle'?'castle':'market';
    const size=Math.max(unit*8,Math.min(unit*12,r*3.8)),label=kind==='church'?'教堂':kind==='castle'?'城堡':'集市广场';
    result.landmarks.push({districtId:district.id,kind,center:p,radius:size*.5,label});
    result.symbols.push({kind:'image',icon:kind,label,center:{...p},width:size,height:size,color:palette.dark,halo:palette.light});
  }
  return result;
}
