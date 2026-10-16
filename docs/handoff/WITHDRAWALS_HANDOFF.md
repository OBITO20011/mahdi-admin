# تسليم: سحوبات المالك (PR1) — عمل غير مكتمل (WIP)

الفرع: `feature/withdrawals-cheques` من `main` (eafc711). توقف العمل بقرار المالك
(انتهى رصيد السحابة). المرجع الملزم: `docs/design/OWNER_WITHDRAWALS_DESIGN_AR.md`
وقرارات المالك 2026-10-15 (1–4). الشيكات (PR2) وبطاقة الشيكات القائمة (PR3) لم تبدأ.
لم يُلمس `docs/agent` ولا السقف ولا `DB_FUNCTIONS`.

## ما اكتمل

### قاعدة البيانات (migrations 180–182، جديدة وغير مدموجة)
- `180_owner_cash_withdrawals.sql`: جدولا `owner_cash_withdrawals`
  و`owner_cash_withdrawal_reversals` (RPC-only: RLS + REVOKE، غير قابلة للتعديل/الحذف/TRUNCATE،
  الاستثناء الوحيد إلغاء إرجاع داخل عكس الوردية الكامل)؛
  `create_owner_cash_withdrawal_v1` (للمالك فقط، idempotency، قفل الوردية، رفض
  «بالدرج X فقط» — القرار 2)؛ `reverse_owner_cash_withdrawal_v1` (للمالك فقط بسبب
  5–500 حرف، يرجع للوردية الأصلية إن كانت مفتوحة وإلا لوردية الفرع المفتوحة، ولقطة
  الوردية الأصلية لا تتغير — القرار 1)؛ تعريف صريح لـ`get_cash_shift_summary`
  و`cancel_empty_cash_shift` و`preview_cash_shift_full_reversal`
  و`reverse_cash_shift_with_operations` (خطة قبل أي كتابة، ثم عكس ذري للسحوبات
  وإلغاء إرجاعات الورديات الأخرى — القرار 3).
- `181_owner_withdrawal_readers.sql`: تقرير أحداث السحوبات بالصفحات
  (`get_owner_withdrawals_report`)، قائمة سحوبات الوردية، قسم `ownerWithdrawals` في
  لقطة الإغلاق (الإصدار يبقى 1)، كتلة للمالك فقط في `get_operational_business_report`
  و`get_home_dashboard` (صافي الربح / السحوبات / المتبقي؛ الربح غير المتاح يبقى null).
- `182_owner_withdrawal_monitoring.sql`: معادلة `integrity:shifts:closing` تطرح أثر
  السحوبات (والوردية المعكوسة كلياً محايدة)، وفحص حرج جديد
  `integrity:accounting:owner-withdrawals`.

### الواجهة
- `src/services/supabase/ownerWithdrawals.service.ts` (أسماء RPC حرفية، بلا `.from`).
- `src/features/shifts/OwnerWithdrawalsPanel.tsx` + ربطه في `ShiftsView` (للمالك فقط)،
  وسطرا «سحوبات المالك (−)» و«إرجاع سحوبات المالك (+)» في حركة الدرج، وكتلة السحوبات في
  معاينة عكس الوردية الكامل.
- قسم السحوبات في `ShiftClosingReportModal` + سطر «صافي الحركة بعد السحوبات».
- `src/features/reports/OwnerWithdrawalsReportSection.tsx` في مركز التقارير
  (صافي الربح، السحوبات، المتبقي في المحل + توضيح «ليس رصيد الدرج أو البنك»، قائمة أحداث
  بصفحات، زر عكس).
- بطاقة المالك في `DashboardHome`.
- القرار 4 (تنبيه بلا منع): `src/hooks/useDrawerShortfallConfirm.tsx` موصول في
  `ExpenseFormModal` و`SupplierPaymentModal` و`RecordSupplierPaymentModal`
  و`CreateDirectReceiptModal` و`GoLiveSetupView` (سداد رصيد المورد السابق). لا تغيير
  في منطق قاعدة البيانات للدفع/المصروف.

### الاختبارات
- `scripts/testing/run-owner-withdrawals-runtime.mjs` (MAX 182، قاعدة معزولة).
- `tests/owner-withdrawals.test.ts` (فحوص ثابتة للـmigrations والواجهة).

## آخر نتيجة اختبار معروفة
- اختبار التشغيل `run-owner-withdrawals-runtime.mjs`: **نجح كاملاً**
  (`{"ok":true,"mode":"OWNER_WITHDRAWALS_RUNTIME"}`) يشمل: سيناريو 100/30 ⇒ 80/30/10 ⇒
  100/30/30، السقف، الأدوار، التكرار/النقر المزدوج/تبويبان، تزامن الإغلاق، عكس وردية
  مغلقة في وردية مفتوحة، الفروع والصفحات، عكس الوردية الكامل (رفض قبل الكتابة، فشل
  محقون يتراجع، نجاح)، عدم القابلية للتعديل، حقن خلل للمراقبة، backup/restore + replay،
  و`db lint`. **ملاحظة:** بعده عُدّلت فقط دالة `get_home_dashboard` في 181 (الربح null
  يبقى null) — لم يُعَد التشغيل بعد هذا التعديل.
- `tests/owner-withdrawals.test.ts`: آخر تشغيل 9 نجاح / 1 فشل (regex في الاختبار نفسه)،
  وصُحّح الـregex ولم يُعَد التشغيل.
- `tsc --noEmit` نظيف، وeslint نظيف على الملفات المعدلة.
- مجموعة الاختبارات الكاملة `npm test`: **لم تُشغّل** (أُوقفت بطلب المالك).

## ما لم يكتمل (بالترتيب)
1. `npm run agent:preflight` ثم إعادة تشغيل
   `node scripts/testing/run-owner-withdrawals-runtime.mjs` و
   `npx tsx --test tests/owner-withdrawals.test.ts`.
2. `npm test` كاملاً؛ الفشل المتوقع فقط هو فحوص السقف/الأدلة التي يصلحها Codex عند
   الدمج (agent-continuity، frankfurt-reference، generated DB reference، تسلسل أرقام
   migrations، service/table access). أي فشل آخر (مثل حراس parity لـ`ShiftsView`
   أو `useAppStore` أو صفحات أخرى) يحتاج إصلاحاً أو mapping معتمداً على نمط
   `tests/strict-product-legacy-source.ts`.
3. إعادة توليد الجرد: `node scripts/audit/service-access-inventory.mjs` وجرد الجداول
   (JSON فقط).
4. سكربت npm `test:owner-withdrawals:runtime` وخطوة CI في `.github/workflows/quality.yml`
   بجانب خطوات go-live.
5. اختبار متصفح (Playwright) بالمقاسات 390/820/1440 × فاتح/داكن + axe: لوحة السحب في
   الورديات، تقرير الإغلاق، قسم التقارير، بطاقة الرئيسية، تنبيه القرار 4.
6. تحويل الـPR من مسودة إلى جاهز للمراجعة (بلا دمج).
7. بعدها PR2 (الشيكات، migrations 183+) ثم PR3 (بطاقة «شيكات قائمة»).

## أسئلة مالية مفتوحة (قبل PR2/PR3، لا تخمين)
- PR3: هل رصيد الزبون/المورد الافتتاحي يُدخل قبل خصم الشيك القائم أم بعده؟ وكيف يُسجل
  شيك مُجيَّر قائم (زبون + مورد) عند بداية التشغيل؟
- PR2: تأكيد مسار سداد قيد ذمة المورد التعويضي (شيك صادر راجع) — هل يُسدد بنفس سداد
  الرصيد السابق (163) أم مقابل المستند الأصلي؟

## ملاحظات تصميم
- عكس الوردية الكامل يعمل على الوردية المفتوحة فقط (قيد قائم في النواة)، ووردية فيها
  سحوبات فقط ليست «فارغة»: تُغلق عادياً وتُعكس السحوبات فردياً.
- لقطة الإغلاق تبقى `closing_report_snapshot_version = 1` (قيد CHECK في 094)، والقسم
  الجديد يحمل `sectionVersion: 1`.
