import {expect, test, type BrowserContext, type Page} from '@playwright/test';

const baseUrl = process.env.ADMIN_SESSION_E2E_BASE_URL;
const email = process.env.ADMIN_SESSION_E2E_EMAIL;
const password = process.env.ADMIN_SESSION_E2E_PASSWORD;
const enabled = Boolean(baseUrl && email && password);
const idleLockMs = 15 * 60 * 1_000;

const turnstileShim = `
window.turnstile = {
  render: function (_container, options) {
    window.__isolatedTurnstileOptions = options;
    queueMicrotask(function () { options.callback('XXXX.DUMMY.TOKEN.XXXX'); });
    return 'isolated-admin-session-widget';
  },
  reset: function () {
    var options = window.__isolatedTurnstileOptions;
    if (options) queueMicrotask(function () { options.callback('XXXX.DUMMY.TOKEN.XXXX'); });
  },
  remove: function () {}
};`;

const installTurnstileShim = async (context: BrowserContext) => {
  await context.addInitScript({content: turnstileShim});
};

const waitForCaptcha = async (page: Page) => {
  await expect(page.getByText('تم التحقق ✓')).toBeVisible({timeout: 30_000});
};

const loginWithIsolatedUser = async (page: Page) => {
  await page.goto(baseUrl!);
  await waitForCaptcha(page);
  await page.locator('input[type="email"]').fill(email!);
  await page.locator('input[type="password"]').fill(password!);
  await page.getByRole('button', {name: 'تسجيل الدخول', exact: true}).click();
  await expect(page.locator('main')).toBeVisible({timeout: 60_000});
};

const openProfileSecurity = async (page: Page) => {
  await page.locator('[data-bottom-tab="more"]').click();
  await page.getByRole('button', {name: /الإدارة والمتجر/}).click();
  await page.locator('[data-navigation-id="profile-summary"]').click();
  const profileModal = page.locator('.fixed.inset-0.z-50');
  await profileModal.getByRole('button', {name: 'الأمان والجلسات', exact: true}).click();
};

const ageSession = async (page: Page, ageMs: number) => {
  await page.evaluate(async (age) => {
    const runtimeImport = (modulePath: string) => import(/* @vite-ignore */ modulePath);
    const storeModule = await runtimeImport('/src/stores/useAuthStore.ts');
    const securityModule = await runtimeImport('/src/services/sessionSecurity.service.ts');
    const engine = storeModule.authStoreEngine as unknown as {
      getState: () => {user: {id: string} | null};
      startSessionSecurityTracking: (snapshot: unknown) => void;
    };
    const userId = engine.getState().user?.id;
    if (!userId) throw new Error('The isolated Admin session is not authenticated.');
    const current = securityModule.readAdminSessionSecuritySnapshot(userId);
    if (!current) throw new Error('The Admin security snapshot is missing.');
    const now = Date.now();
    const aged = {...current, lastActivityAt: now - age, lockedAt: null};
    securityModule.writeAdminSessionSecuritySnapshot(aged);
    engine.startSessionSecurityTracking(aged);
  }, ageMs);
};

const readSecuritySnapshot = async (page: Page) => page.evaluate(async () => {
  const runtimeImport = (modulePath: string) => import(/* @vite-ignore */ modulePath);
  const storeModule = await runtimeImport('/src/stores/useAuthStore.ts');
  const securityModule = await runtimeImport('/src/services/sessionSecurity.service.ts');
  const userId = storeModule.authStoreEngine.getState().user?.id;
  return userId ? securityModule.readAdminSessionSecuritySnapshot(userId) : null;
});

const unlock = async (page: Page, value: string) => {
  await page.locator('input[type="password"]').fill(value);
  const unlockButton = page.getByRole('button', {name: 'فتح التطبيق'});
  await expect(unlockButton).toBeEnabled({timeout: 30_000});
  await unlockButton.click();
};

test.describe('isolated integrated Admin session security', () => {
  test.skip(!enabled, 'Run through scripts/testing/run-admin-session-browser-e2e.mjs only.');

  test('real login → idle lock → reauth → multi-tab → logout', async ({page, context}) => {
    await installTurnstileShim(context);
    const pageErrors: string[] = [];
    const unexpectedAuthResponses: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if ([401, 403].includes(response.status())) {
        unexpectedAuthResponses.push(`${response.status()} ${new URL(response.url()).pathname}`);
      }
    });

    await page.goto(baseUrl!);
    await waitForCaptcha(page);
    await page.locator('input[type="email"]').fill(email!);
    await page.locator('input[type="password"]').fill('wrong-isolated-password');
    await page.getByRole('button', {name: 'تسجيل الدخول', exact: true}).click();
    await expect(page.getByText('البريد الإلكتروني أو كلمة المرور غير صحيحة')).toBeVisible({
      timeout: 30_000,
    });
    await waitForCaptcha(page);
    await page.locator('input[type="password"]').fill(password!);
    await page.getByRole('button', {name: 'تسجيل الدخول', exact: true}).click();
    await expect(page.locator('main')).toBeVisible({timeout: 60_000});

    await page.locator('[data-bottom-tab="orders"]').click();
    await expect(page.locator('[data-bottom-tab="orders"]')).toHaveAttribute('aria-current', 'page');
    await page.locator('[data-bottom-tab="home"]').click();
    const beforeLock = await readSecuritySnapshot(page);
    expect(beforeLock).not.toBeNull();

    await ageSession(page, idleLockMs + 1);
    const expired = await readSecuritySnapshot(page);
    const ordersTab = page.locator('[data-bottom-tab="orders"]');
    const box = await ordersTab.boundingBox();
    if (!box) throw new Error('The protected navigation action is missing.');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByRole('heading', {name: 'الدخول بكلمة المرور'})).toBeVisible();
    await expect(page.locator('main')).toHaveCount(0);
    await expect(page.locator('[data-bottom-tab="orders"]')).toHaveCount(0);
    expect((await readSecuritySnapshot(page))?.lastActivityAt).toBe(expired?.lastActivityAt);

    await unlock(page, 'wrong-isolated-password');
    await expect(page.getByText('البريد الإلكتروني أو كلمة المرور غير صحيحة')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('main')).toHaveCount(0);
    await unlock(page, password!);
    await expect(page.locator('main')).toBeVisible({timeout: 60_000});
    const afterUnlock = await readSecuritySnapshot(page);
    expect(afterUnlock?.absoluteSessionStartedAt).toBe(beforeLock?.absoluteSessionStartedAt);

    const otherTab = await context.newPage();
    await otherTab.goto(baseUrl!);
    await expect(otherTab.locator('main')).toBeVisible({timeout: 60_000});
    await ageSession(page, idleLockMs - 1_000);
    await page.locator('[data-bottom-tab="home"]').click();
    await expect.poll(async () =>
      (await readSecuritySnapshot(otherTab))?.lastActivityAt,
    ).toBe((await readSecuritySnapshot(page))?.lastActivityAt);

    await ageSession(page, idleLockMs + 1);
    // The second tab receives the expired snapshot through the real storage
    // event, locks it, and writes the monotonic locked state back immediately.
    await expect(page.locator('main')).toHaveCount(0);
    await expect(otherTab.locator('main')).toHaveCount(0);
    await otherTab.close();

    await unlock(page, password!);
    await expect(page.locator('main')).toBeVisible({timeout: 60_000});
    await page.locator('[data-bottom-tab="more"]').click();
    await page.getByRole('button', {name: 'تسجيل الخروج', exact: true}).click();
    await expect(page.getByText('تسجيل الدخول للنظام')).toBeVisible({timeout: 30_000});
    await page.reload();
    await expect(page.getByText('تسجيل الدخول للنظام')).toBeVisible({timeout: 30_000});

    expect(unexpectedAuthResponses).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('MFA status failure settles, retry is single-flight, and unmount is safe', async ({page, context}) => {
    await installTurnstileShim(context);
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await loginWithIsolatedUser(page);

    let userRequestCount = 0;
    let enrollmentRequestCount = 0;
    let delayNextRequest = false;
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/auth/v1/factors')) {
        enrollmentRequestCount += 1;
      }
    });
    await context.route('**/auth/v1/user', async (route) => {
      userRequestCount += 1;
      if (userRequestCount === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({message: 'test-only sensitive upstream detail'}),
        });
        return;
      }
      if (delayNextRequest) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        delayNextRequest = false;
      }
      await route.continue();
    });

    await openProfileSecurity(page);
    const profileModal = page.locator('.fixed.inset-0.z-50');
    await expect(profileModal.getByText('تعذر الفحص')).toBeVisible({timeout: 15_000});
    await expect(page.getByRole('button', {name: 'إعادة المحاولة'})).toBeVisible();
    await expect(page.getByText('test-only sensitive upstream detail')).toHaveCount(0);

    await page.getByRole('button', {name: 'إعادة المحاولة'}).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect(page.getByText('غير مفعلة', {exact: true})).toBeVisible();
    const enrollmentButton = page.getByRole('button', {name: 'تفعيل تطبيق المصادقة'});
    await expect(enrollmentButton).toBeEnabled();
    expect(userRequestCount).toBe(2);

    await enrollmentButton.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect(profileModal.getByAltText('رمز QR لتطبيق المصادقة')).toBeVisible();
    expect(enrollmentRequestCount).toBe(1);
    await profileModal.getByRole('button', {name: 'إلغاء', exact: true}).click();
    await expect(enrollmentButton).toBeEnabled();

    await profileModal.getByRole('button', {name: 'إغلاق'}).click();
    delayNextRequest = true;
    await page.locator('[data-navigation-id="profile-summary"]').click();
    await profileModal.getByRole('button', {name: 'الأمان والجلسات', exact: true}).click();
    await profileModal.getByRole('button', {name: 'إغلاق'}).click();
    await page.waitForTimeout(500);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors.some((message) => message.includes('status of 503'))).toBe(true);
    expect(
      consoleErrors.filter((message) => !message.includes('status of 503'))
    ).toEqual([]);
  });

  test('MFA hung status request recovers with a fresh generation and ignores the late request', async ({page, context}) => {
    await installTurnstileShim(context);
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await loginWithIsolatedUser(page);

    let userRequestCount = 0;
    let releaseFirstRequest!: () => void;
    const firstRequestGate = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve;
    });
    await context.route('**/auth/v1/user', async (route) => {
      userRequestCount += 1;
      if (userRequestCount === 1) await firstRequestGate;
      await route.continue();
    });

    await openProfileSecurity(page);
    const profileModal = page.locator('.fixed.inset-0.z-50');
    await expect(profileModal.getByText('تعذر الفحص')).toBeVisible({timeout: 15_000});

    await page.getByRole('button', {name: 'إعادة المحاولة'}).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect(profileModal.getByText('غير مفعلة', {exact: true})).toBeVisible({timeout: 15_000});
    expect(userRequestCount).toBe(2);

    releaseFirstRequest();
    await page.waitForTimeout(500);
    await expect(profileModal.getByText('غير مفعلة', {exact: true})).toBeVisible();
    await expect(profileModal.getByText('تعذر الفحص')).toHaveCount(0);

    await profileModal.getByRole('button', {name: 'إغلاق'}).click();
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
