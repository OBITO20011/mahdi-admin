# شاشة المخزون الاختياري — الترقية224

مسودة للمراجعة؛ لا إذن اتصال أو ترقية مستضافة أو نشر.221 تبقى محجوزة، وتفعيل المحاسبة ممنوع قبلها.
بعد اعتماد الحزمة ودمجها وإذن المالك المنفصل: **223/183 ← 224/184**. إذا كان السقف220، أكمل222 ثم223 وحماية كل منهما أولاً؛ لا backfill لـ221.

1. ثبّت SHA main وCI والبصمات. جهّز مرجع224 عبر [عدّةD−1](D1_REFERENCE_KIT224_AR.md)، واعتمده وثبّته في مجلّد العمل نفسه قبل فحص الترقية. أغلق الطلبات وجمّد جميع الكتّاب واحفظ حالة التنبيهات.
2. قبل أخذ نسخة 223 شغّل `node scripts/operations/frankfurt-owner-upgrade224.mjs --preflight-registration --workdir '<المجلد>'`. يستعمل الأمر المجلد المرتبط وسؤال كلمة المرور المخفي المعتاد. انتظر `ok:true` و`registrationPreflight` بالقيمتين `ceiling:223` و`files:183`. عند `UPGRADE_REGISTRATION_PREFLIGHT_FAILED` توقّف، وثبّت الربط والاعتماد والسجل قبل المتابعة. بعد نجاح الفحص خذ Backup223 كاملاً واسترجعه محلياً بمقارنة صارمة تشمل جداول العدّاد الثلاثة وحالة pg_net.
3. أداة المالك: `node scripts/operations/frankfurt-owner-upgrade224.mjs --dry-run --workdir '<المجلد>'`. هذه خطة محلية؛ لا تقرأ حالة مستضافة.
4. بعد الإذن شغّل `node scripts/operations/frankfurt-owner-upgrade224.mjs --apply --workdir '<المجلد>' --backup-evidence '<تقرير Backup223>'`. يعيد الأمر فحص التسجيل بالـCLI نفسه قبل أي كتابة، ويطلب السجل الحرفي 223/183. عند نجاح التطبيق والتسجيل يظهر `ok:true` و`protectionPending:true`.
5. Backup224 ثم Restore معزول صارم، ثم `node scripts/operations/frankfurt-owner-upgrade224.mjs --verify-only --workdir '<المجلد>' --backup-evidence '<تقرير Backup224>' --restore-evidence '<تقرير Restore224>' --upgrade-report '<تقرير apply224>'`. لا متابعة دون `complete:true`.
6. قبل القطع، ثبّت أن المرجع يخصّ SHA النهائي. إن تغيّر الرأس فجهّز مرجعاً جديداً واعتمده وثبّته، ثم أعد بروفة النسخة الفاصلة. [RESET224](RESET224_OWNER_AR.md) مخصّص ليوم القطع؛ تحديث التجربة يقتصر على الترقية.

إذا ظهر `SQL_APPLIED_REGISTRATION_PENDING`، أبقِ الكتابات والطلبات والتنبيهات مجمّدة. استخدم المسار الظاهر في `registrationState` وتقرير النسخة الأصلية:

```powershell
node scripts/operations/frankfurt-owner-upgrade224.mjs --resume-registration --workdir '<المجلد نفسه>' --backup-evidence '<تقرير Backup223 نفسه>' --registration-state '<مسار registrationState>'
```

الاستئناف يفحص سجل 223/183 وكتالوج 224 وبصمات البيانات والإعدادات قبل تسجيل 224 عبر `--linked` فقط. عند `ok:true` و`protectionPending:true` استخدم `report.json` من **مجلّد الاستئناف الجديد** وأكمل الخطوة 5. يفحص `--verify-only` سجل 224/184. عند أي رفض، بما فيه ظهور 224 مسجّلة رغم رسالة الفشل، أبقِ الكتابات مجمّدة وراجع التقرير مع المالك. لا تكرّر `--apply` أو تسجّل الإصدار يدوياً.

224 تضيف قارئاً واحداً للمالك+AAL2 في OFF، ولا جدول أو تريغر أو تعديل لمسار البيع.688 دالة عامة و51 خاصة،184 ملفاً،13عضواً فيRealtime. بصمة migration: `f706c9b09d76f0d28dc431320cae993f209142955c7b70f813f6514068ec631d`.
كل صف أعمال/عداد/حركة/مفتاح طلب يبقى حرفياً أثناء الترقية. تظل أدوات وأسقف214–223 بأسمائها ومراجعها؛ لا تعِد تسمية مرجع قديم.

الإثبات المحلي: apply8.5ث، Backup4.7–5.6ث، Restore18.5–20.8ث، verify-only4.2ث؛ RESET27.7ث وثلاثةاستئنافات22.9–28.0ث. هذه أزمنة Docker وهمي لا تختصر توقيع المالك أو بروفةD−1 ولا تثبت حالة فرانكفورت.
