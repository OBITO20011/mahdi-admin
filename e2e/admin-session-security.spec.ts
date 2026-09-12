import {expect, test} from '@playwright/test';

test('locked session removes protected Admin content from the DOM', async ({page}) => {
  await page.goto('http://127.0.0.1:4173/e2e/admin-session-security-harness.html');

  await expect(page.getByTestId('protected-admin-content')).toBeVisible();
  await page.evaluate(() => window.__ADMIN_SESSION_TEST_SET_LOCKED__(true));

  await expect(page.getByTestId('protected-admin-content')).toHaveCount(0);
  await expect(page.getByRole('heading', {name: 'الدخول بكلمة المرور'})).toBeVisible();

  await page.evaluate(() => window.__ADMIN_SESSION_TEST_SET_LOCKED__(false));
  await expect(page.getByTestId('protected-admin-content')).toBeVisible();
});

test('password fallback rejects a wrong password and unlocks without email entry', async ({page}) => {
  await page.goto('http://127.0.0.1:4173/e2e/admin-session-security-harness.html');
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
