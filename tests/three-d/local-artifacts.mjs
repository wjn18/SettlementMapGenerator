import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Structural checks inspect backend artifacts locally, never through public URLs.
export async function localJobJson(job,name) {
  const root=process.env.SETTLEMENT_3D_JOBS_ROOT??'artifacts/web-3d';
  return JSON.parse(await fs.readFile(path.join(root,job.id,name),'utf8'));
}

export async function assertImageOnlyDownloads(base,job) {
  assert(Object.keys(job.files).every(name=>name.endsWith('.png')));
  for(const name of ['scene.blend','source-town.json','scene-manifest.json','verification.json','asset-integration.json','pipeline-performance.json']) {
    assert.equal(job.files[name],undefined);
    const response=await fetch(`${base}/api/3d/jobs/${job.id}/files/${name}?download=1`);
    assert.equal(response.status,404,`${name} must stay private`);
    await response.body.cancel();
  }
}
