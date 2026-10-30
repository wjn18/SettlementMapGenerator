import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTown, serializeTown, deserializeTown, validateTown } from '../../packages/core/dist/index.js';
import { Point, Polygon, containsPolygon } from '../../packages/core/dist/geometry.js';
import { fitCathedral } from '../../packages/core/dist/cathedral.js';
import { polygonTouchesRiver } from '../../packages/core/dist/river.js';
import { GenerationContext, ResourceLimitError } from '../../packages/core/dist/context.js';

const polygon = ps => new Polygon(ps.map(([x,y]) => new Point(x,y)));
const rectangle = (x,y,w,h) => polygon([[x,y],[x+w,y],[x+w,y+h],[x,y+h]]);
function checkLayout(block, layout) {
  assert(layout); const {parts} = layout;
  assert.equal(parts.filter(p => p.role === 'main_hall').length, 1);
  assert.equal(parts.filter(p => p.role === 'bell_tower').length, 1);
  for (const {role,shape} of parts) {
    assert(containsPolygon(block,shape)); assert.equal(shape.length,4);
    const lengths = shape.map((a,i) => Point.distance(a,shape[(i+1)%4]));
    assert(Math.min(...lengths)>=1.5-1e-8); // 6m exported minimum, including wings.
    for (let i=0;i<4;i++) assert(Math.abs(shape.vectori(i).dot(shape.vectori((i+1)%4)))<1e-7);
    if (role==='bell_tower') assert(Math.max(...lengths)/Math.min(...lengths)<1.000001);
    if (role==='main_hall') assert(Math.max(...lengths)/Math.min(...lengths)<2.41);
  }
  // Intersections of rectangle interiors are forbidden; shared connecting
  // edges are allowed. Use the separating-axis test, independently of fitting.
  for (let i=0;i<parts.length;i++) for (let j=i+1;j<parts.length;j++) {
    const a=parts[i].shape,b=parts[j].shape;
    assert([...a,...b].some((_,k) => {
      const p=k<4?a:b,axis=p.vectori(k%4).rotate90().norm();
      const as=a.map(v=>v.dot(axis)),bs=b.map(v=>v.dot(axis));
      return Math.min(Math.max(...as),Math.max(...bs))-Math.max(Math.min(...as),Math.min(...bs))<1e-7;
    }));
  }
}

test('triangle, skewed and concave church sites keep regular connected architecture', () => {
  for (const block of [polygon([[0,0],[50,0],[10,70]]),polygon([[0,0],[45,7],[40,48],[-5,35]]),
    polygon([[0,0],[45,0],[45,18],[22,18],[22,50],[0,50]])]) {
    const before=block.map(p=>[p.x,p.y]), layout=fitCathedral(block);
    checkLayout(block,layout); assert.deepEqual(block.map(p=>[p.x,p.y]),before);
    block.rotate(0.73); checkLayout(block,fitCathedral(block));
  }
});

test('reported size-80 wedge fits a normal nave, square tower and two short wings', () => {
  const block=polygon([[132.630295,146.008567],[127.361479,147.564689],[93.925029,108.146971],
    [35.708476,40.340495],[-40.196092,-48.067717],[57.985498,-67.515209],[74.646247,-70.815316],[97.787531,15.718537]]);
  block.forEach(p=>p.scaleEq(.25));
  const layout=fitCathedral(block.shrinkEq(2.25)); checkLayout(block,layout);
  assert.equal(layout.parts.length,4); assert(layout.parts[0].shape.square>50);
});

test('road constraints relocate the church intact; impossible slivers are rejected', () => {
  // A small but wide enough lot still fits the minimum church, even when its
  // area-based target width would be smaller than the architectural minimum.
  const small=rectangle(0,0,9,5); checkLayout(small,fitCathedral(small));
  const block=rectangle(0,0,45,45),centerline=[new Point(0,22.5),new Point(45,22.5)];
  const accepts=shape=>!polygonTouchesRiver(shape,{centerline,width:5,bankWidth:1});
  const layout=fitCathedral(block,{accepts}); checkLayout(block,layout);
  assert(layout.parts.every(p=>accepts(p.shape)));
  assert.equal(fitCathedral(rectangle(0,0,100,2)),null);
  assert.equal(fitCathedral(polygon([[0,0],[60,0],[0,2]])),null);
  assert.equal(fitCathedral(block,{accepts:()=>false}),null);
  assert.throws(()=>fitCathedral(block,{context:new GenerationContext(1,0)}),ResourceLimitError);
});

test('new inland and waterfront plans export explicit church roles without road crossings', () => {
  for (const seed of [1,42,12345,869133548]) for (const size of [12,24,80])
    for (const water of [{},{river:true},{coast:'east'},{coast:'west',river:true}]) {
      const options={seed,size,castle:true,walls:true,plaza:true,maxAttempts:40,...water},result=generateTown(options);
      assert(result.ok,JSON.stringify({options,result})); const town=result.town; validateTown(town);
      const districts=town.districts.filter(d=>d.wardType==='Cathedral'); assert.equal(districts.length,1,JSON.stringify(options));
      const v=new Map(town.vertices.map(p=>[p.id,new Point(p.x,p.y)])),district=districts[0];
      const buildings=town.buildings.filter(b=>b.districtId===district.id);
      const layout={parts:buildings.map(b=>({role:b.architecturalRole,shape:new Polygon(b.boundary.map(id=>v.get(id)))}))};
      checkLayout(new Polygon(district.boundary.map(id=>v.get(id))),layout);
      for (const {shape} of layout.parts) for (const road of town.roads)
        assert(!polygonTouchesRiver(shape,{centerline:road.vertexIds.map(id=>v.get(id)),width:road.width,bankWidth:.01}),JSON.stringify(options));
      assert.deepEqual(deserializeTown(serializeTown(town)),town);
      assert.deepEqual(generateTown(options),result);
    }
});

test('church role JSON is strict and old unlabelled buildings remain lossless', () => {
  const result=generateTown({seed:42,size:24}); assert(result.ok);
  const town=result.town,church=town.buildings.filter(b=>b.architecturalRole);
  assert(church.length>=2);
  const invalid=fn=>{const copy=structuredClone(town);fn(copy);assert.throws(()=>validateTown(copy));};
  invalid(t=>{t.buildings.find(b=>b.architecturalRole).architecturalRole='corridor';});
  invalid(t=>{delete t.buildings.find(b=>b.architecturalRole).architecturalRole;});
  invalid(t=>{t.buildings.find(b=>b.architecturalRole==='bell_tower').architecturalRole='main_hall';});
  invalid(t=>{t.buildings.find(b=>!b.architecturalRole).architecturalRole='annex';});
  const legacy=structuredClone(town); for(const b of legacy.buildings) delete b.architecturalRole;
  legacy.generatorVersion='0.13.0'; assert.deepEqual(deserializeTown(serializeTown(legacy)),legacy);
});
