// Read-only browser check against a local history entry with a failed report.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
const base=process.env.THREE_D_TEST_BASE??'http://127.0.0.1:5174';
const state=await(await fetch(base+'/api/3d/status')).json();
const job=state.jobs.find(j=>j.status==='failed'&&j.errorSummary&&j.files['verification.json']);
assert(job,'A preserved failed task with verification diagnostics is required.');
const reportResponse=await fetch(base+job.files['verification.json']);assert.equal(reportResponse.status,200);
const verification=await reportResponse.json();assert.equal(verification.status,'fail');
assert.deepEqual(job.validationFailures,verification.failures);
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1500,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/?test=1&seed=7&size=6&castle=false&walls=true&plaza=true&view=3d&job='+job.id);
  await page.waitForSelector('body[data-ready="true"]');
  await page.waitForFunction(id=>document.querySelector('#three-d-history').value===id,job.id);
  assert.equal(await page.locator('#three-d-error').textContent(),job.errorSummary);
  const details=page.locator('.three-d-technical');assert.equal(await details.isVisible(),true);
  assert.equal(await details.getAttribute('open'),null);
  await details.locator('summary').click();assert.equal(await details.locator('pre').textContent(),job.error);
  const link=page.locator('#three-d-downloads a').filter({hasText:'校验报告'});assert.equal(await link.count(),1);
  assert((await link.getAttribute('href')).includes(job.files['verification.json']));
  assert((await page.locator('#three-d-history option:checked').textContent()).includes('失败'));
  await details.locator('summary').click();
  await fs.mkdir('artifacts/history-diagnostics',{recursive:true});
  await page.screenshot({path:'artifacts/history-diagnostics/readable-history.png'});
  assert.deepEqual(errors,[]);
  await fs.writeFile('artifacts/history-diagnostics/browser-verification.json',JSON.stringify({passed:true,jobId:job.id,summary:job.errorSummary,checks:['readable failure cause','technical log retained and collapsible','failed report downloadable','failed history clearly labeled'],pageErrors:errors},null,2));
  console.log('PASS history diagnostics',job.id);
} finally {await browser.close();}
