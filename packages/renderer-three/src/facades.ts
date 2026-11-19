import { at, circle, MeshBatch, strip, world, type XY } from './mesh.js';

/** Coordinates along the actual wall, above its foot, and out towards the street. */
export function wallDetail(mesh:MeshBatch,a:XY,b:XY,normal:XY) {
  const length=a.distanceTo(b);
  const plan=(u:number,depth:number)=>at(a,b,u/length).addScaledVector(normal,depth);
  const p=(u:number,h:number,d:number)=>world(plan(u,d),h);
  function beam(u:number,z:number,v:number,h:number,width:number,paint:string,depth=.13) {
    const d=Math.hypot(v-u,h-z);
    if(d<.001) return;
    const x=(h-z)*width/(2*d),y=(u-v)*width/(2*d);
    const face=[[u+x,z+y],[v+x,h+y],[v-x,h-y],[u-x,z-y]];
    mesh.quad(p(face[0][0],face[0][1],depth),p(face[1][0],face[1][1],depth),p(face[2][0],face[2][1],depth),p(face[3][0],face[3][1],depth),paint);
    for(const [i,l] of face.entries()){
      const r=face[(i+1)%4];
      mesh.quad(p(l[0],l[1],.03),p(r[0],r[1],.03),p(r[0],r[1],depth),p(l[0],l[1],depth),paint);
    }
  }
  function rose(u:number,z:number,r:number) {
    const sectors=24,stone='#c8baa0',lead='#827d72';
    const wheel=(i:number,radius:number,depth:number)=>p(u+radius*Math.cos(i*2*Math.PI/sectors),z+radius*Math.sin(i*2*Math.PI/sectors),depth);
    const glass=['#697e81','#a17169','#88978a','#a69a72','#738492','#8b7582'];
    for(let i=0;i<sectors;i++){
      mesh.triangle(p(u,z,.095),wheel(i,r*.89,.095),wheel(i+1,r*.89,.095),glass[(i>>1)%glass.length]);
      mesh.quad(wheel(i,r*.84,.19),wheel(i+1,r*.84,.19),wheel(i+1,r,.19),wheel(i,r,.19),stone);
      mesh.quad(wheel(i,r,.04),wheel(i+1,r,.04),wheel(i+1,r,.19),wheel(i,r,.19),stone);
      mesh.quad(wheel(i,r*.28,.15),wheel(i+1,r*.28,.15),wheel(i+1,r*.34,.15),wheel(i,r*.34,.15),lead);
      if(i%3===0) {
        const angle=i*2*Math.PI/sectors;
        beam(u+r*.31*Math.cos(angle),z+r*.31*Math.sin(angle),u+r*.87*Math.cos(angle),z+r*.87*Math.sin(angle),r*.07,lead,.15);
      }
    }
  }
  function buttress(u:number,h:number) {
    const layers=[[0,h*.13,.55,.96],[h*.13,h*.56,.42,.81],[h*.56,h*.60,.48,.85],
      [h*.60,h*.84,.33,.54],[h*.84,h*.88,.37,.58],[h*.88,h*.95,.25,.36]];
    for(const [lo,hi,half,d] of layers)
      mesh.prism(strip(plan(u,.01),plan(u,d),half),lo+.012,hi,'#b5a58c');
  }
  function lantern(u:number) {
    const c=plan(u,.35);
    beam(u,2.06,u,2.37,.10,'#574e43',.4);
    mesh.prism(circle(c,.23,4),1.68,2.02,'#cbac72');
    mesh.prism(circle(c,.26,4),1.60,1.69,'#554e44');
    mesh.prism(circle(c,.27,4),2.02,2.13,'#554e44');
  }
  return {beam,rose,buttress,lantern};
}
