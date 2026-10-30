import test from 'node:test';
import assert from 'node:assert/strict';
import { readTownOptions } from '../../scripts/three-d-options.mjs';

test('default 3D planning keeps the existing inland seed and features',()=>{
  assert.deepEqual(readTownOptions([]),{seed:7,size:6,walls:true,castle:false,plaza:true});
});
test('a normal 3D command can request a coastal harbor and its city features',()=>{
  assert.deepEqual(readTownOptions(['--seed','42','--size','12','--coast','west','--harbor','true','--river','false','--walls','true','--castle','true','--plaza','auto']),{seed:42,size:12,coast:'west',harbor:true,river:false,walls:true,castle:true,plaza:'auto'});
});
test('all coast sides and explicit port/inland switches retain their meanings',()=>{
  for(const side of ['east','south','west','north','auto'])assert.equal(readTownOptions(['--coast',side]).coast,side);
  assert.equal(readTownOptions(['--coast','false']).coast,false);
  assert.equal(readTownOptions(['--harbor','false']).harbor,false);
});
test('JSON input cannot silently ignore planning edits',()=>{
  assert.deepEqual(readTownOptions(['--input','town.json']),readTownOptions([]));
  assert.throws(()=>readTownOptions(['--input','town.json','--coast','east']),/preserves the saved plan/);
  assert.throws(()=>readTownOptions(['--input','town.json','--seed','42']),/preserves the saved plan/);
});
test('invalid or incomplete terrain choices fail before launching Blender',()=>{
  assert.throws(()=>readTownOptions(['--harbor','yes']),/true or false/);
  assert.throws(()=>readTownOptions(['--coast','eastward']),/--coast requires/);
  assert.throws(()=>readTownOptions(['--coast']),/Missing value/);
});
test('river harbor has an independent strict CLI switch',()=>{
  assert.equal(readTownOptions(['--river','true','--river-harbor','true','--harbor','false']).riverHarbor,true);
  assert.throws(()=>readTownOptions(['--river-harbor','yes']),/true or false/);
  assert.throws(()=>readTownOptions(['--input','town.json','--river-harbor','true']),/preserves the saved plan/);
});
