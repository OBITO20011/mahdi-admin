# سجل توقعات العرض الرقمية في اختبارات CI

اعتماد المالك عبر Claude بتاريخ15نوفمبر2026: تحويل حرفي لنفس القيمة فقط؛لا تغيير واجهة أو منطق أو حمولة أو مهلة.

الجولة الأولى: سطران بملفين،معتمدان ومطبّقان فيa03dbf26:

- `e2e/document-corrections207.spec.ts:10`: `.toContainText('٢')` → `.toContainText('2')`.
- `e2e/package-f-trial-ta.spec.ts:7`: `name:'اختر ٣ باكيت'` → `name:'اختر 3 باكيت'`.

الجولة الثانية:16سطراً في9ملفات،مطابقة حرفياً للرقعة التي راجعها Claude. أبقيت المدخلات العربية وبيانات SKU/أسماء الصور وأسماء المنتجات الأصلية،وجميع حراس منع عرض الأرقام العربية. يشمل السجل التسميات السلبية المقابلة حتى يبقى فحصها فعالاً.

```diff
--- a/e2e/customer-checkout-simplification.spec.ts
+++ b/e2e/customer-checkout-simplification.spec.ts
@@ -168 +168 @@
-  await checkout.getByRole('button', { name: 'خارج الرمثا أجرة التوصيل ٢٫٥٠٠ د.أ' }).click();
+  await checkout.getByRole('button', { name: 'خارج الرمثا أجرة التوصيل 2.500 د.أ' }).click();
--- a/e2e/customer-checkout-isolated.spec.ts
+++ b/e2e/customer-checkout-isolated.spec.ts
@@ -10 +10 @@
-const parcelSizeLabel = (5).toLocaleString('ar-JO');
+const parcelSizeLabel = '5';
--- a/e2e/customer-compact-product-grid.spec.ts
+++ b/e2e/customer-compact-product-grid.spec.ts
@@ -144 +144 @@
-    await expect(page.getByText('١٫٢٥٠ د.أ').first()).toBeVisible();
+    await expect(page.getByText('1.250 د.أ').first()).toBeVisible();
--- a/e2e/customer-order-tracking.spec.ts
+++ b/e2e/customer-order-tracking.spec.ts
@@ -61 +61 @@
-    await expect(trackingDialog.getByText('١٢٫٧٥٠ د.أ')).toBeVisible();
+    await expect(trackingDialog.getByText('12.750 د.أ')).toBeVisible();
--- a/e2e/customer-presentational-characterization.spec.ts
+++ b/e2e/customer-presentational-characterization.spec.ts
@@ -212 +212 @@
-  await expect(receipt.getByText('٢٫٢٥٠ د.أ', { exact: true })).toBeVisible();
+  await expect(receipt.getByText('2.250 د.أ', { exact: true })).toBeVisible();
@@ -275 +275 @@
-  await expect(tracking.getByText('٢٫٢٥٠ د.أ')).toBeVisible();
+  await expect(tracking.getByText('2.250 د.أ')).toBeVisible();
--- a/e2e/customer-storefront-c6.spec.ts
+++ b/e2e/customer-storefront-c6.spec.ts
@@ -19 +19 @@
-  await expect(parcels).toContainText(`طرد (${(10).toLocaleString('ar-JO')} باكيت)`);
+  await expect(parcels).toContainText(`طرد (10 باكيت)`);
@@ -20 +20 @@
-  await expect(dialog).not.toContainText('قنينة');await expect(parcels).toContainText('٥٫٥٠٠ د.أ');await expect(units).toContainText('٠٫٥٥٠ د.أ');
+  await expect(dialog).not.toContainText('قنينة');await expect(parcels).toContainText('5.500 د.أ');await expect(units).toContainText('0.550 د.أ');
@@ -25 +25 @@
-  await expect(page.getByText(`تمت إضافة ${(3).toLocaleString('ar-JO')} باكيت من ${product.nameAr}.`,{exact:true})).toBeVisible();
+  await expect(page.getByText(`تمت إضافة 3 باكيت من ${product.nameAr}.`,{exact:true})).toBeVisible();
@@ -55 +55 @@
-  const single=dialog.getByRole('region',{name:'إضافة باكيت',exact:true});await expect(single).toContainText('٧٫٠٠٠ د.أ');
+  const single=dialog.getByRole('region',{name:'إضافة باكيت',exact:true});await expect(single).toContainText('7.000 د.أ');
@@ -68 +68 @@
- await expect(page.getByText(`تمت إضافة ${(3).toLocaleString('ar-JO')} باكيت من ${product.nameAr}.`,{exact:true})).toBeVisible();
+ await expect(page.getByText(`تمت إضافة 3 باكيت من ${product.nameAr}.`,{exact:true})).toBeVisible();
--- a/e2e/lite-parcel-unit-guard.spec.ts
+++ b/e2e/lite-parcel-unit-guard.spec.ts
@@ -55 +55 @@
- await expect(page.getByText('باكيت (٧ باكيت)',{exact:false})).toHaveCount(0);
+ await expect(page.getByText('باكيت (7 باكيت)',{exact:false})).toHaveCount(0);
@@ -116 +116 @@
- await expect(page.getByText('طرد (٢٤ باكيت)',{exact:false}).first()).toBeVisible();
+ await expect(page.getByText('طرد (24 باكيت)',{exact:false}).first()).toBeVisible();
--- a/e2e/phase6-package-b.spec.ts
+++ b/e2e/phase6-package-b.spec.ts
@@ -102 +102 @@
-  const summary = `${(3).toLocaleString('ar-JO')} باكيت + ${(2).toLocaleString('ar-JO')} طرد`;
+  const summary = `3 باكيت + 2 طرد`;
@@ -106 +106 @@
-  await expect(page.getByText(`${(5).toLocaleString('ar-JO')} طرد`, {exact: true})).toHaveCount(0);
+  await expect(page.getByText(`5 طرد`, {exact: true})).toHaveCount(0);
--- a/e2e/public-apps.spec.ts
+++ b/e2e/public-apps.spec.ts
@@ -306 +306 @@
-    await expect(page.getByTestId('hero-stats').getByText('٦٬٠٠٠', {exact: true})).toBeVisible();
+    await expect(page.getByTestId('hero-stats').getByText('6,000', {exact: true})).toBeVisible();
```

الأسعار والكميات العددية لم تتغير. أبقيت beforeText والبصمات السابقة والحارس الذي يرفض البايت المجهول؛أضيفت بصمات مسارات الاختبارات المتغيرة إلى طبقة العرض الدقيقة فقط.

التفويض المسبق اللاحق محصور في توقع يفشل حصراً لأنه ينتظر تمثيلًا عربياً لنفس القيمة؛يسجل كل سطر إضافي هنا. أي فرق قيمة/نص/توقيت/واجهة يوقف المتابعة. لا أسطر إضافية خارج الجولتين حتى هذا الالتزام.
