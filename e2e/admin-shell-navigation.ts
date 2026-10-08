import type { Locator, Page } from '@playwright/test';

/**
 * Package F shell: desktop (>=1024px) navigates through the SideNav, phones
 * through the bottom tabs. Both expose the same activeTab destinations, and
 * only one of them is visible at a time.
 */
export const shellTab = (page: Page, tab: string): Locator =>
  page.locator(`[data-side-nav="${tab}"]:visible, [data-bottom-tab="${tab}"]:visible`);

/** Every rendered copy (visible or not) — for asserting the shell is gone. */
export const anyShellTab = (page: Page, tab: string): Locator =>
  page.locator(`[data-side-nav="${tab}"], [data-bottom-tab="${tab}"]`);

/**
 * Opens a "More" destination: directly from the SideNav on desktop, through
 * the More accordion on phones.
 */
export const openShellDestination = async (page: Page, groupId: string, destinationId: string) => {
  const sideItem = page.locator(`[data-side-nav-item="${destinationId}"]:visible`);
  if ((await sideItem.count()) > 0) {
    await sideItem.click();
    return;
  }
  await shellTab(page, 'more').click();
  const group = page.locator(`[data-navigation-group="${groupId}"]`);
  const trigger = group.locator('button').first();
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await page.locator(`[data-navigation-id="${destinationId}"]`).click();
};
