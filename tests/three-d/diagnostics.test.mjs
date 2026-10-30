import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { failureDiagnostics } from '../../apps/playground/server/three-d-diagnostics.mjs';
async function fixture(report) {
  const dir=path.resolve('artifacts/history-diagnostics/unit',randomUUID());await fs.mkdir(dir,{recursive:true});
  if(report)await fs.writeFile(path.join(dir,'verification.json'),JSON.stringify(report));return dir;
}
test('feature failures get readable summaries while retaining the exact cause',async()=>{
  const failure='Planned feature is missing or its required region footprint changed: f4';
  const result=await failureDiagnostics(await fixture({status:'fail',features:[{id:'f4',kind:'grove'}],failures:[failure]}));
  assert.match(result.errorSummary,/树丛 f4/);assert.deepEqual(result.validationFailures,[failure]);assert.equal(result.failedStage,'verify_scene');
});
test('sea precision failures can be identified without showing a Python stack',async()=>{
  const result=await failureDiagnostics(await fixture({status:'fail',failures:['The actual sea boundary or water level differs from the source coast.']}));
  assert.match(result.errorSummary,/海面边界或水位/);
});
test('successful or missing verification never fabricates a validation failure',async()=>{
  assert.deepEqual(await failureDiagnostics(await fixture({status:'pass',failures:[]})),{});
  assert.deepEqual(await failureDiagnostics(await fixture()),{});
});
