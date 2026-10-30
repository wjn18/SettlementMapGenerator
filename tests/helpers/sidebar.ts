import type { Page } from '@playwright/test';

type SidebarTask = 'generate' | 'three-d' | 'population' | 'files';

/** Navigate through the same task controls a person uses. */
export async function openSidebarTask(page: Page, task: SidebarTask): Promise<void> {
  await page.locator(`#task-${task}`).click();
}

export async function selectRenderer(page: Page, renderer: string): Promise<void> {
  await openSidebarTask(page, 'generate');
  const advanced = page.locator('#sidebar-advanced');
  if (await advanced.getAttribute('open') === null) await advanced.locator('summary').click();
  await page.locator('#renderer').selectOption(renderer);
}
