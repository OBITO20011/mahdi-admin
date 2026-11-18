# RESET225 — يوم التشغيل بالمحاسبة الكاملة

بعد اكتمال حماية 225، والحجز والنسخة الفاصلة والاسترجاع، شغّل [استعلام Storage القرائي](RESET224_STORAGE_CAPABILITY_READ_ONLY.sql) بدور التنفيذ. المطلوب `actor=postgres` و`session_actor=postgres` و`policy_configuration_allows=true`. أي نتيجة مختلفة توقف التصفير. طابق SHA المرجع المعتمد مع [D−1](D1_REFERENCE_KIT225_AR.md).

```powershell
node scripts/operations/frankfurt-owner-reset225.mjs --plan --workdir '<مجلد العمل المعتمد>' --reference '<مسار local-reference-through225-ready.json>'
node scripts/operations/frankfurt-owner-reset225.mjs --dry-run --workdir '<مجلد العمل المعتمد>' --reference '<مسار local-reference-through225-ready.json>' --owner-id '<UUID المالك>'
node scripts/operations/frankfurt-owner-reset225.mjs --apply --workdir '<مجلد العمل المعتمد>' --reference '<مسار local-reference-through225-ready.json>' --owner-id '<UUID المالك>'
```

قارن خطة dry-run، ومعرّف المالك، و225/185، والنسخة الفاصلة قبل تأكيد apply. المطلوب `ok:true` و`complete:true` وكتالوج وصلاحيات مطابقان. أكّد من الشاشة أن المحاسبة ON والطلبات مغلقة، ثم وقّع «الوضع ON مُثبت».

إذا تعطل التصفير بعد البدء، أبقِ الواجهات والكتابات موقوفة واحفظ تقرير المرحلة. استعمل `--resume` بنفس المجلد والمرجع ومعرّف المالك فقط إذا سمحت الأداة، واتبع عبارة التأكيد المعروضة. احتفظ بعلامة الاستئناف ولقطة النسخة الأصلية حتى النجاح.
