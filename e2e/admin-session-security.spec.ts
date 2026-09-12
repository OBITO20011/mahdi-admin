import {expect, test, type Page} from '@playwright/test';

const harnessUrl = 'http://127.0.0.1:4173/e2e/admin-session-security-harness.html';
const idleLockMs = 15 * 60 * 1_000;

const unlockWithPassword = async (page: Page) => {
  await page.locator('input[type="password"]').fill('correct-password');
  await page.evaluate(() => window.__ADMIN_SESSION_TEST_VERIFY_TURNSTILE__());
  await page.getByRole('button', {name: 'فتح التطبيق'}).click();
  await expect(page.getByTestId('protected-admin-content')).toBeVisible();
};

const sendTrustedPointerActivity = async (page: Page) => {
  const box = await page.getByTestId('protected-admin-content').boundingBox();
  if (!box) throw new Error('Protected Admin content is not available for pointer activity.');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

test('locked session removes protected Admin content from the DOM', async ({page}) => {
  await page.goto(harnessUrl);

  await expect(page.getByTestId('protected-admin-content')).toBeVisible();
  await page.evaluate(() => window.__ADMIN_SESSION_TEST_SET_LOCKED__(true));

  await expect(page.getByTestId('protected-admin-content')).toHaveCount(0);
  await expect(page.getByRole('heading', {name: 'الدخول بكلمة المرور'})).toBeVisible();

  await page.evaluate(() => window.__ADMIN_SESSION_TEST_SET_LOCKED__(false));
  await expect(page.getByTestId('protected-admin-content')).toBeVisible();
});

test('password fallback rejects a wrong password and unlocks without email entry', async ({page}) => {
  await page.goto(harnessUrl);
  await page.evaluate(() => window.__ADMIN_SESSION_TEST_SET_LOCKED__(true));

  const email = page.locator('input[type="email"]');
  const password = page.locator('input[type="password"]');
  await expect(email).toHaveValue('owner@example.test');
  await expect(email).toHaveAttribute('readonly', '');

  await password.fill('wrong-password');
  await page.getByRole('button', {name: 'فتح التطبيق'}).click();
  await expect(page.getByText('كلمة المرور غير صحيحة.')).toBeVisible();
  await expect(page.getByTestId('protected-admin-content')).toHaveCount(0);

  await password.fill('correct-password');
  await page.evaluate(() => window.__ADMIN_SESSION_TEST_VERIFY_TURNSTILE__());
  await page.getByRole('button', {name: 'فتح التطبيق'}).click();
  await expect(page.getByTestId('protected-admin-content')).toBeVisible();
});

test('activity is accepted before the boundary and locks at 15 minutes exactly', async ({page}) => {
  await page.goto(harnessUrl);

  await page.evaluate((age) => window.__ADMIN_SESSION_TEST_AGE_ACTIVITY__(age), idleLockMs - 1_000);
  const beforeActivity = await page.evaluate(() =>
    window.__ADMIN_SESSION_TEST_STATE__().storedSnapshot?.lastActivityAt,
  );
  await sendTrustedPointerActivity(page);
  const activeState = await page.evaluate(() => window.__ADMIN_SESSION_TEST_STATE__());
  expect(activeState.isSessionLocked).toBe(false);
  expect(activeState.storedSnapshot?.lastActivityAt).toBeGreaterThan(beforeActivity || 0);

  await page.evaluate((age) => window.__ADMIN_SESSION_TEST_AGE_ACTIVITY__(age), idleLockMs);
  const expiredActivity = await page.evaluate(() =>
    window.__ADMIN_SESSION_TEST_STATE__().storedSnapshot?.lastActivityAt,
  );
  await sendTrustedPointerActivity(page);
  await expect(page.getByTestId('protected-admin-content')).toHaveCount(0);
  const lockedState = await page.evaluate(() => window.__ADMIN_SESSION_TEST_STATE__());
  expect(lockedState.isSessionLocked).toBe(true);
  expect(lockedState.storedSnapshot?.lockedAt).not.toBeNull();
  expect(lockedState.storedSnapshot?.lastActivityAt).toBe(expiredActivity);
});

test('first pointer and keyboard events after expiry cannot revive the session', async ({page}) => {
  await page.goto(harnessUrl);

  await page.evaluate((age) => window.__ADMIN_SESSION_TEST_AGE_ACTIVITY__(age), idleLockMs + 1);
  const actionBox = await page.getByTestId('protected-admin-action').boundingBox();
  if (!actionBox) throw new Error('Protected action is not available.');
  await page.mouse.click(actionBox.x + actionBox.width / 2, actionBox.y + actionBox.height / 2);
  await expect(page.getByTestId('protected-admin-content')).toHaveCount(0);
  const pointerState = await page.evaluate(() => window.__ADMIN_SESSION_TEST_STATE__());
  expect(pointerState.isSessionLocked).toBe(true);
  expect(pointerState.protectedActionCount).toBe(0);

  await unlockWithPassword(page);
  await page.evaluate((age) => window.__ADMIN_SESSION_TEST_AGE_ACTIVITY__(age), idleLockMs + 1);
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('protected-admin-content')).toHaveCount(0);
  expect(await page.evaluate(() => window.__ADMIN_SESSION_TEST_STATE__().isSessionLocked)).toBe(true);
});

test('background evaluation, reload and a newly opened tab enforce expiry', async ({page, context}) => {
  await page.goto(harnessUrl);
  await page.evaluate((age) => window.__ADMIN_SESSION_TEST_AGE_ACTIVITY__(age), idleLockMs + 1);
  await page.evaluate(() => window.__ADMIN_SESSION_TEST_EVALUATE__());
  await expect(page.getByTestId('protected-admin-content')).toHaveCount(0);

  await unlockWithPassword(page);
  await page.evaluate((age) => window.__ADMIN_SESSION_TEST_AGE_ACTIVITY__(age), idleLockMs + 1);
  await page.reload();
  await expect(page.getByTestId('protected-admin-content')).toHaveCount(0);

  await unlockWithPassword(page);
  await page.evaluate((age) => window.__ADMIN_SESSION_TEST_AGE_ACTIVITY__(age), idleLockMs + 1);
  const newTab = await context.newPage();
  await newTab.goto(harnessUrl);
  await expect(newTab.getByTestId('protected-admin-content')).toHaveCount(0);
  await newTab.close();
});

test('multi-tab activity propagates before expiry and cannot bypass lock after expiry', async ({page, context}) => {
  await page.goto(harnessUrl);
  const otherTab = await context.newPage();
  await otherTab.goto(harnessUrl);

  await page.evaluate((age) => window.__ADMIN_SESSION_TEST_AGE_ACTIVITY__(age), idleLockMs - 1_000);
  await sendTrustedPointerActivity(page);
  await expect.poll(async () => {
    const first = await page.evaluate(() => window.__ADMIN_SESSION_TEST_STATE__().lastActivityAt);
    const second = await otherTab.evaluate(() => window.__ADMIN_SESSION_TEST_STATE__().lastActivityAt);
    return first === second;
  }).toBe(true);

  await otherTab.evaluate((age) => window.__ADMIN_SESSION_TEST_AGE_ACTIVITY__(age), idleLockMs + 1);
  await otherTab.keyboard.press('Tab');
  await expect(otherTab.getByTestId('protected-admin-content')).toHaveCount(0);
  await expect(page.getByTestId('protected-admin-content')).toHaveCount(0);
});

test('password unlock preserves the absolute start and refreshes protected data', async ({page}) => {
  await page.goto(harnessUrl);
  await page.evaluate((age) => window.__ADMIN_SESSION_TEST_AGE_ACTIVITY__(age), idleLockMs + 1);
  await sendTrustedPointerActivity(page);
  const absoluteStart = await page.evaluate(() =>
    window.__ADMIN_SESSION_TEST_STATE__().absoluteSessionStartedAt,
  );

  await unlockWithPassword(page);
  await expect.poll(() => page.evaluate(() => window.__ADMIN_SESSION_TEST_STATE__().refreshCount)).toBe(3);
  const unlocked = await page.evaluate(() => window.__ADMIN_SESSION_TEST_STATE__());
  expect(unlocked.absoluteSessionStartedAt).toBe(absoluteStart);
  expect(unlocked.isSessionLocked).toBe(false);
});
