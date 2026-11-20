import { at, MeshBatch, pair, point, strip, world, type XY } from './mesh.js';
import { faceYaw, fitKit, mount, type Focus, type Mount } from './placement.js';

// All dimensions in plan stay inside the clearance reserved for this tower.
export function buildWallTower(mesh: MeshBatch, mounts: Mount[], id: string, center: XY, radius: number,
    wallHeight: number, exterior: XY, wallArms: XY[], castle: boolean): Focus {
  const sides = castle ? 8 : 10;
  const start = exterior.angle() - Math.PI / sides;
  const spokes = Array.from({length:sides}, (_,i) => point(Math.cos(start + i*2*Math.PI/sides), Math.sin(start + i*2*Math.PI/sides)));
  const ring = (size: number) => spokes.map(n => center.clone().addScaledVector(n, radius*size));
  const deck = wallHeight + 2.2, sill = deck + .84, crest = sill + 1.04;
  const stone = '#b5a58e', trim = '#cdbda1', shade = '#9f8f79';
  const shaft = ring(.82), bodyLow=deck*.18+.28, bodyHigh=deck-.60;
  // A band may slope, project horizontally, or turn back down the inside of the parapet.
  const band = (r0: number, h0: number, r1: number, h1: number, color: string, pattern = 0) => {
    const a = ring(r0), b = ring(r1);
    for (let i=0; i<sides; i++) {
      const j=(i+1)%sides;
      mesh.quad(world(a[i],h0),world(a[j],h0),world(b[j],h1),world(b[i],h1),color,pattern);
    }
  };
  mesh.entity(id, () => {
    band(1,0,1,.46,shade,2);
    band(1,.46,.87,deck*.18,trim,2);
    band(.87,deck*.18,.87,deck*.18+.15,trim);
    band(.87,deck*.18+.15,.82,deck*.18+.28,stone);
    for (let i=0;i<sides;i++) {
      const a=shaft[i], b=shaft[(i+1)%sides], middle=at(a,b,.5);
      const n=middle.clone().sub(center).normalize(), tangent=b.clone().sub(a).normalize();
      const half=a.distanceTo(b)/2, faceRadius=middle.distanceTo(center);
      // Omit slits where the two adjoining wall spans cover this facet.
      if(wallArms.some(arm=>n.dot(arm)>0 && Math.abs(n.cross(arm))*faceRadius<1.05+radius*.16)) {
        mesh.quad(world(a,bodyLow),world(b,bodyLow),world(b,bodyHigh),world(a,bodyHigh),stone,2);
        continue;
      }
      const xyz=(u:number,h:number,depth=0)=>world(middle.clone().addScaledVector(tangent,u).addScaledVector(n,-depth),h);
      const face=(left:number,right:number,low:number,high:number)=>
        mesh.quad(xyz(left,low),xyz(right,low),xyz(right,high),xyz(left,high),stone,2);
      const width=Math.min(.94,radius*.30), mouth=.41*width, throat=.18*width;
      const depth=Math.min(.30,radius*.1), base=i%2===0 ? deck*.51+.55 : deck*.22+.2;
      const top=base+1.65;
      face(-half,-mouth,bodyLow,bodyHigh); face(mouth,half,bodyLow,bodyHigh);
      face(-mouth,mouth,bodyLow,base); face(-mouth,mouth,top,bodyHigh);
      // Splayed stone reveals lead to a narrower, recessed opening and its original ironwork.
      const lip=[xyz(-mouth,base),xyz(mouth,base),xyz(mouth,top),xyz(-mouth,top)];
      const back=[xyz(-throat,base+.15,depth),xyz(throat,base+.15,depth),xyz(throat,top-.15,depth),xyz(-throat,top-.15,depth)];
      for(let j=0;j<4;j++) mesh.quad(lip[j],lip[(j+1)%4],back[(j+1)%4],back[j],j===0?trim:shade);
      const kit='castle_keep_openings_01__arrow_loop', kitDepth=depth*.42;
      const insert=middle.clone().addScaledVector(n,-depth-kitDepth);
      mesh.quad(xyz(-mouth,base,depth+kitDepth+.01),xyz(mouth,base,depth+kitDepth+.01),
        xyz(mouth,top,depth+kitDepth+.01),xyz(-mouth,top,depth+kitDepth+.01),'#59554e');
      mounts.push(mount(kit,id,insert,base,faceYaw(n),fitKit(kit,width,top-base,kitDepth),1));
    }
    band(.82,deck*.51,.85,deck*.51+.10,shade);
    band(.85,deck*.51+.10,.85,deck*.51+.25,trim);
    band(.85,deck*.51+.25,.82,deck*.51+.32,trim);

    const outer=ring(.97), inner=ring(.74), capOuter=ring(.99), capInner=ring(.72);
    for (const n of spokes) {
      // A projecting stone bracket under every merlon supports the wider platform.
      const tangent=point(-n.y,n.x);
      const tip=(width:number, reach:number) => center.clone().addScaledVector(n,radius*reach).addScaledVector(tangent,radius*width);
      const foot=[tip(-.07,.78),tip(.07,.78),tip(.07,.84),tip(-.07,.84)];
      const head=[tip(-.10,.78),tip(.10,.78),tip(.10,.965),tip(-.10,.965)];
      for(let i=0;i<4;i++) {
        const j=(i+1)%4;
        mesh.quad(world(foot[i],deck-1.28),world(foot[j],deck-1.28),world(head[j],deck-.52),world(head[i],deck-.52),trim);
      }
    }
    band(.82,deck-.60,.96,deck-.46,shade);
    band(.96,deck-.46,1,deck-.27,trim);
    band(1,deck-.27,1,deck-.10,trim);
    band(1,deck-.10,.97,deck,trim);
    band(.97,deck,.97,sill,stone,2);
    band(.97,sill,.74,sill,trim);
    band(.74,sill,.74,deck,shade,2);
    mesh.surface([inner.map(pair)],deck,'#b3a691',4);
    for(let i=0;i<sides;i++) {
      const prev=(i+sides-1)%sides, next=(i+1)%sides;
      const tooth=(outside: XY[], inside: XY[], width: number) => [
        at(outside[i],outside[prev],width),outside[i],at(outside[i],outside[next],width),
        at(inside[i],inside[next],width),inside[i],at(inside[i],inside[prev],width),
      ];
      mesh.prism(tooth(outer,inner,.265),sill,crest-.16,stone,false,2);
      mesh.prism(tooth(capOuter,capInner,.29),crest-.16,crest,trim,true);
    }

    // Timber hatch, separate boards and two iron straps on the open wall walk.
    const across=point(-exterior.y,exterior.x), hatch=center.clone().addScaledVector(exterior,-.16*radius);
    const hatchPoint=(u:number,v:number)=>hatch.clone().addScaledVector(across,u*radius).addScaledVector(exterior,v*radius);
    mesh.prism(strip(hatchPoint(-.32,0),hatchPoint(.32,0),radius*.27),deck,deck+.08,'#786954');
    for(let i=0;i<5;i++) {
      const u=(i-2)*.116;
      mesh.prism(strip(hatchPoint(u,-.23),hatchPoint(u,.23),radius*.055),deck+.08,deck+.13,i%2?'#9c8468':'#a68e6e');
    }
    for(const v of [-.14,.14]) mesh.prism(strip(hatchPoint(-.28,v),hatchPoint(.28,v),radius*.017),deck+.13,deck+.16,'#665f55');
  });

  return {target:world(center,crest*.52),direction:world(exterior,.51),span:crest*1.58};
}
