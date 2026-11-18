# ترقية 224 إلى 225 — أسعار ON والمحاسبة

شغّل التسلسل كاملاً من main المعتمد بسقف 225. المراحل هي 220/181 ثم 222/182 ثم 223/183 ثم 224/184 ثم 225/185. يسبقها حجز الترقية، وتكتمل حماية كل مرحلة قبل التالية. 221 محجوزة.

جهّز [مرجع D−1/225](D1_REFERENCE_KIT225_AR.md) قبل نافذة القطع. بصمة migration 225 هي `c20975214dcc8f2c67cc6fc21235e04ed7e5ec96081db24b0eeecedc2553dde1`. راجع [خطة القطع](GO_LIVE_CUTOVER_AR.md) للتجميد والتوقيع.

1. بعد `complete:true` لـ224، تأكد من أن الطلبات مغلقة والوظائف المطلوبة موقوفة. شغّل فحص التسجيل قبل أخذ Backup224. المطلوب `ok:true` و`registrationPreflight: {ceiling:224,files:184}`. عند `UPGRADE_REGISTRATION_PREFLIGHT_FAILED` توقّف. راجع الربط والاعتماد والسجل دون استخدام وسيط.
2. خذ Backup224 واسترجعها معزولة بمقارنة صارمة. راجع الخطة المحلية. طبّق بموافقة المالك وتقرير النسخة نفسه. المطلوب `ok:true` و`protectionPending:true`.
3. خذ Backup225 واسترجعها معزولة، ثم شغّل `verify-only` مع تقارير النسخة والاسترجاع والتطبيق. المطلوب `ok:true` و`complete:true` وسجل 225/185. أي رفض يوقف الانتقال لحجز RESET. مراجع الإصدارات الأقدم مستقلة.

```powershell
node scripts/operations/frankfurt-owner-upgrade225.mjs --preflight-registration --workdir '<مجلد العمل المعتمد>'
node scripts/operations/frankfurt-owner-upgrade225.mjs --dry-run --workdir '<مجلد العمل المعتمد>'
node scripts/operations/frankfurt-owner-upgrade225.mjs --apply --workdir '<مجلد العمل المعتمد>' --backup-evidence '<تقرير Backup224>'
node scripts/operations/frankfurt-owner-upgrade225.mjs --verify-only --workdir '<مجلد العمل المعتمد>' --backup-evidence '<تقرير Backup225>' --restore-evidence '<تقرير Restore225>' --upgrade-report '<تقرير apply225 أو resume225>'
```

إذا ظهر `SQL_APPLIED_REGISTRATION_PENDING`، أبقِ التجميد واستخدم تقرير Backup224 نفسه ومسار `registrationState` المطبوع. الاستئناف يتحقق من كتالوج 225 وسجل 224 وبصمات البيانات، ثم يسجّل 225 فقط. استخدم تقرير مجلّد الاستئناف الجديد في verify-only. عند أي رفض توقّف. كلمة المرور تُدخل في السؤال المخفي للأداة.

```powershell
node scripts/operations/frankfurt-owner-upgrade225.mjs --resume-registration --workdir '<مجلد العمل المعتمد>' --backup-evidence '<تقرير Backup224 نفسه>' --registration-state '<مسار registrationState>'
```
