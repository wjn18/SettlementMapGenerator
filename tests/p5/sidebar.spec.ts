import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const start = '/?test=1&seed=7&size=12&plaza=true&castle=false&walls=false&coast=false&river=false';
const tasks = ['generate', 'three-d', 'population', 'files'] as const;

test.beforeEach(async ({ page }) => {
  await page.goto(start);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
});

test('task navigation preserves pending settings and the fixed action submits the generator', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 720 });
  const before = await page.evaluate(() => ({
    count: window.__playground.generationCount,
    town: JSON.stringify(window.__playground.town),
  }));
  await page.locator('#seed').fill('42');
  await page.locator('#size').selectOption('24');

  for (const task of tasks) {
    await page.locator(`#task-${task}`).click();
    for (const other of tasks) {
      await expect(page.locator(`#task-${other}`)).toHaveAttribute('aria-selected', String(other === task));
      if (other === task) await expect(page.locator(`#sidebar-${other}`)).toBeVisible();
      else await expect(page.locator(`#sidebar-${other}`)).toBeHidden();
    }
  }
  await page.locator('#task-generate').click();
  await expect(page.locator('#seed')).toHaveValue('42');
  await expect(page.locator('#size')).toHaveValue('24');
  expect(await page.evaluate(() => ({
    count: window.__playground.generationCount,
    town: JSON.stringify(window.__playground.town),
  }))).toEqual(before);

  await expect(page.locator('#harbor')).toBeDisabled();
  await expect(page.locator('#river-harbor')).toBeDisabled();
  await page.locator('#coast').selectOption('east');
  await expect(page.locator('#harbor')).toBeEnabled();
  await page.locator('#coast').selectOption('false');
  await expect(page.locator('#harbor')).toBeDisabled();
  await page.locator('#river').selectOption('true');
  await expect(page.locator('#river-harbor')).toBeEnabled();
  await page.locator('#river-harbor').selectOption('true');
  await page.locator('#river').selectOption('false');
  await expect(page.locator('#river-harbor')).toBeDisabled();
  await page.locator('#river').selectOption('true');
  await expect(page.locator('#river-harbor')).toHaveValue('true');
  await page.locator('#river').selectOption('false');

  await page.locator('#sidebar-advanced summary').click();
  await page.locator('#renderer').selectOption('svg');
  await expect(page.locator('#generate')).toBeInViewport();
  await expect(page.locator('#generate')).toBeEnabled();
  await page.locator('#generate').click();
  await expect(page).toHaveURL(/seed=42/);
  await expect(page.locator('#parameters')).toBeEnabled();
  expect(await page.evaluate(() => window.__playground.generationCount)).toBe(before.count + 1);
  expect(await page.evaluate(() => window.__playground.town.request.seed)).toBe(42);
  expect(await page.evaluate(() => window.__playground.town.request.size)).toBe(24);
});

test('population and file tasks operate on the current town without generating a new layout', async ({ page }) => {
  const before = await page.evaluate(() => ({
    count: window.__playground.generationCount,
    town: JSON.stringify(window.__playground.town),
    residents: window.__playground.population.total.residents,
  }));
  await page.locator('#task-population').click();
  await page.locator('#population-density').selectOption('dense');
  expect(await page.evaluate(() => window.__playground.population.total.residents)).toBeGreaterThan(before.residents);
  await expect(page.locator('#population-total')).toBeVisible();
  await page.locator('#population-details summary').click();
  await expect(page.locator('#population-report')).toBeVisible();

  await page.locator('#task-files').click();
  for (const id of ['import', 'export', 'export-image', 'export-svg']) {
    await expect(page.locator(`#${id}`)).toBeVisible();
    await expect(page.locator(`#${id}`)).toBeEnabled();
  }
  const pending = page.waitForEvent('download');
  await page.locator('#export').click();
  const saved = JSON.parse(readFileSync((await (await pending).path())!, 'utf8'));
  expect(saved).toEqual(JSON.parse(before.town));
  expect(await page.evaluate(() => window.__playground.generationCount)).toBe(before.count);
  expect(await page.evaluate(() => JSON.stringify(window.__playground.town))).toBe(before.town);
});

test('all task panels remain usable at a phone width without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const task of tasks) {
    await page.locator(`#task-${task}`).click();
    await expect(page.locator(`#sidebar-${task}`)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
  await page.locator('#task-generate').click();
  await expect(page.locator('#generate')).toBeInViewport();
});
