# Supabase في Nawasrah ERP

## الحالة الحالية

هذا المجلد هو مصدر مخطط Production ويحتوي migrations متسلسلة من `001` حتى
`107`. تطبيق Admin وCustomer Store يستخدمان RPCs وEdge Functions المحمية، ولا
توجد بيانات واجهة تجريبية تعامل كمصدر حقيقة.

## بوابة أي تغيير

```powershell
git status --short
npx supabase migration list
npm.cmd run backup:status
npm.cmd run backup:verify
```

قبل migration جديدة:

1. يجب أن يطابق `main` النظيف `origin/main`.
2. يجب تطابق migrations المحلية والبعيدة.
3. أنشئ ملفًا جديدًا بالرقم التالي فقط؛ لا تعدّل ملفًا تاريخيًا.
4. شغّل isolated rebuild والاختبارات المرتبطة وDB lint.
5. خذ backup مشفرًا verified ونفّذ Restore Drill معزولًا عند بوابات البيانات
   الحساسة.
6. طبّق migration مرة واحدة، ثم تحقق من history وsignature/grants/RLS والسلوك.

> ممنوع تشغيل `supabase db reset` على Production، أو لصق تعديل schema يدويًا
> لتجاوز migration، أو عمل rollback عشوائي لدوال مالية/مخزنية.

## الحدود الأمنية

- الواجهات تستخدم Publishable key فقط.
- RLS يحمي الجداول الإدارية والمالية والمخزنية.
- المال والمخزون والحجوزات تمر عبر RPCs ذرية ومدققة.
- `service_role` محصور داخل Edge Functions الموثقة؛ لا يدخل React أو n8n.
- canonical guest-order RPC خاص؛ anonymous يدخل عبر `submit-guest-order` بعد
  Turnstile/rate-limit validation.
- الدوال العامة للكتالوج والتتبع والإيصال تعيد الحد الأدنى ولا تعرض التكلفة أو
  المورد أو الربح أو PII غير اللازمة.
- وظائف cron الخاصة غير ممنوحة للـ`anon` أو `authenticated`.

## مسار إعادة البناء المعتمد

`npm.cmd run test:db:isolated` ينفذ `HYBRID SANCTIONED BOOTSTRAP`: ينسخ مجلد
Supabase إلى مساحة مؤقتة، ويطبّق compatibility patch المعروف على النسخة المؤقتة
من migration 034، ثم يعيد migrations `001–107` ويتحقق من canonical schema.
ملف 034 التاريخي لا يُعدّل.

Migration `107_canonical_schema_reconciliation.sql` توحّد Fresh وProduction عبر:

- التعريف canonical الموسع لـ`_receive_inventory_impl` مع قفل حتمي لأول رصيد.
- استعادة خمسة triggers لـ`updated_at` وتقوية trigger function.
- حذف كائنات legacy فقط إن كانت فارغة ودون `CASCADE`.
- ترك `rls_auto_enable` خارج النطاق لأنه كائن تديره المنصة.

Fresh Build يثبت قابلية إعادة بناء schema في قاعدة فارغة، أما Backup Restore
فيستعيد بيانات/أدوار/Storage من النسخة المشفرة المتحققة وهو مسار disaster
recovery. لا يحل أحدهما محل الآخر. Clean baseline لاحق تحسين اختياري فقط.

`MIGRATION 107 CANONICAL SCHEMA RECONCILIATION = VERIFIED`.
`DB-01 DATABASE REBUILD PATH = VERIFIED`.

## المجالات المطبقة حتى 107

- المنتجات والنكهات والمخزون والحركات والجرد والتسويات والاستلام وWAC.
- الطلبات والحجوزات والتوصيل والتسوية والمرتجعات والـPOS والذمم والمدفوعات.
- Customer catalog/search/pagination/cart snapshot/checkout/tracking/receipt.
- حد 50 بندًا، انتهاء حجز `website/new` بعد خمس ساعات، وتنظيف rate-limit.
- أرشيف الورديات وclosing snapshot immutable وFull Shift Reversal/AAL2.
- server-side pagination للطلبات والمخزون وCRM والمشتريات والاستلام والدفعات.
- Business outbox مع leases وbounded retry وdead-letter وincidents وsummaries.
- Advanced monitoring وBusiness Integrity وHealth Dashboard للمالك/AAL2.
- Privacy minimization للـautomation payloads في migration `102`.
- canonical schema reconciliation ومسار Fresh المعتمد في migration `107`.

التفاصيل في [DATABASE_DESIGN.md](../DATABASE_DESIGN.md)، ودورة الطلب في
[README-orders.md](./README-orders.md)، وكل contract دقيق مصدره ملف migration
نفسه واختباراته.
