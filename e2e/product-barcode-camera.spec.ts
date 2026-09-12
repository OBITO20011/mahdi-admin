import { expect, test } from '@playwright/test';

const adminBaseUrl =
  process.env.ADMIN_BASE_URL ?? 'http://127.0.0.1:4173';

const harnessUrl = (view: string, scenario = 'success') =>
  `${adminBaseUrl}/e2e/admin-mobile-ux-harness.html?view=${view}&scenario=${scenario}`;

for (const view of ['barcode-add', 'barcode-edit']) {
  test(`${view} captures one product barcode and releases the camera`, async ({
    page,
  }) => {
    await page.goto(harnessUrl(view));
    const barcodeInput = page.getByRole('textbox', {
      name: 'باركود المنتج',
      exact: true,
    });
    await expect
      .poll(() => page.evaluate(() => window.__BARCODE_CAMERA_START_COUNT__))
      .toBe(0);

    await page.getByRole('button', { name: 'مسح باركود المنتج بالكاميرا' }).click();
    await expect(page.getByRole('dialog', { name: 'مسح باركود المنتج' })).toBeVisible();
    await expect(barcodeInput).toHaveValue('6291041500213');
    await expect(page.getByRole('dialog', { name: 'مسح باركود المنتج' })).toBeHidden();

    await expect
      .poll(() =>
        page.evaluate(() => ({
          starts: window.__BARCODE_CAMERA_START_COUNT__,
          stops: window.__BARCODE_CAMERA_STOP_COUNT__,
          options: window.__BARCODE_CAMERA_OPTIONS__,
        }))
      )
      .toEqual({
        starts: 1,
        stops: 1,
        options: { oneShot: true, productBarcodesOnly: true },
      });
  });
}

test('cancel closes the camera, releases it, and preserves manual input', async ({
  page,
}) => {
  await page.goto(harnessUrl('barcode-edit', 'hold'));
  const barcodeInput = page.getByRole('textbox', {
    name: 'باركود المنتج',
    exact: true,
  });
  await expect(barcodeInput).toHaveValue('6251234567890');

  await page.getByRole('button', { name: 'مسح باركود المنتج بالكاميرا' }).click();
  await expect(page.getByRole('dialog', { name: 'مسح باركود المنتج' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__BARCODE_CAMERA_START_COUNT__))
    .toBe(1);
  await page
    .getByRole('button', { name: 'إلغاء مسح الباركود وإغلاق الكاميرا' })
    .click();

  await expect(page.getByRole('dialog', { name: 'مسح باركود المنتج' })).toBeHidden();
  await expect(barcodeInput).toHaveValue('6251234567890');
  await expect(barcodeInput).toBeEditable();
  await expect
    .poll(() => page.evaluate(() => window.__BARCODE_CAMERA_STOP_COUNT__))
    .toBe(1);
});

test('Escape closes and releases the camera while returning focus', async (
  { page },
  testInfo
) => {
  await page.goto(harnessUrl('barcode-add', 'hold'));
  const cameraButton = page.getByRole('button', {
    name: 'مسح باركود المنتج بالكاميرا',
  });
  await cameraButton.click();
  await expect(page.getByRole('dialog', { name: 'مسح باركود المنتج' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__BARCODE_CAMERA_START_COUNT__))
    .toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'مسح باركود المنتج' })).toBeHidden();
  if (testInfo.project.name === 'desktop-chromium') {
    await expect(cameraButton).toBeFocused();
  } else {
    await expect(page.locator('[role="dialog"] :focus')).toHaveCount(0);
  }
  await expect
    .poll(() => page.evaluate(() => window.__BARCODE_CAMERA_STOP_COUNT__))
    .toBe(1);
});

test('duplicate scanned barcode is shown with the approved Arabic message', async ({
  page,
}) => {
  await page.goto(harnessUrl('barcode-add', 'duplicate'));
  await page.getByRole('button', { name: 'مسح باركود المنتج بالكاميرا' }).click();

  await expect(
    page.getByRole('textbox', { name: 'باركود المنتج', exact: true })
  ).toHaveValue('6251234567891');
  await expect(
    page.getByText('الباركود مستخدم بالفعل لمنتج آخر.', { exact: true })
  ).toBeVisible();
});

for (const scenario of ['denied', 'unsupported', 'failure']) {
  test(`${scenario} camera error is Arabic and manual input remains available`, async ({
    page,
  }) => {
    await page.goto(harnessUrl('barcode-add', scenario));
    await page.getByRole('button', { name: 'مسح باركود المنتج بالكاميرا' }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('يدويًا');
    await page.getByRole('button', { name: 'إلغاء والمتابعة بالإدخال اليدوي' }).click();
    await expect(
      page.getByRole('textbox', { name: 'باركود المنتج', exact: true })
    ).toBeEditable();
  });
}

test('new flavor child captures a barcode without saving inventory', async ({
  page,
}) => {
  await page.goto(harnessUrl('barcode-flavor'));
  await page.getByRole('button', { name: 'إضافة نكهة' }).click();
  await page
    .getByRole('button', { name: 'مسح باركود النكهة الجديدة بالكاميرا' })
    .click();

  await expect(
    page.getByRole('textbox', {
      name: 'باركود النكهة الجديدة',
      exact: true,
    })
  ).toHaveValue('6291041500213');
  await expect(
    page.getByRole('button', { name: 'استلام مخزون لهذه النكهة' })
  ).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: 'حفظ تعريف النكهة' })
  ).toBeVisible();
});

test('existing flavor child captures a barcode in edit mode', async ({ page }) => {
  await page.goto(harnessUrl('barcode-flavor'));
  await page.getByRole('button', { name: 'تعديل النكهة' }).first().click();
  await page
    .getByRole('button', { name: /مسح باركود نكهة تفاح بالكاميرا/ })
    .click();

  await expect(
    page.getByRole('textbox', { name: 'باركود نكهة تفاح', exact: true })
  ).toHaveValue('6291041500213');
});

test('flavor master has no camera barcode path', async ({ page }) => {
  await page.goto(harnessUrl('barcode-master'));
  await expect(
    page.getByRole('textbox', { name: 'باركود المنتج', exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'مسح باركود المنتج بالكاميرا' })
  ).toBeDisabled();
});
