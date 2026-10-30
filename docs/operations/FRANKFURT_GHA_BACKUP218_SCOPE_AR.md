# النسخ السحابي218 — النطاق المعتمد وحالة الإثبات

قرار المالك في30 أكتوبر2026: المستودع يبقى عاماً الآن؛يحوّله المالك بنفسه
إلىPrivate بعد التشغيل والاستقرار. **ممنوع إدخال كلمة القاعدة أو دور النسخ
أوpassphrase أو مفاتيحR2 إلىGitHub قبل التحويل.**

workflow النسخ النهائي يجب أن يتحقق من `github.event.repository.private == true`
قبلcheckout أو أي خطوة تستخدم اعتماداً،ويرفض التشغيل العام. ويبقى مفتاح
`NAWASRAH_GHA_BACKUP_ENABLED` مغلقاً؛منبه26ساعة لا يعمل قبل التفعيل.
لا تغيير لمهامWindows الخمس أو سياساتR2.

## الدور المعتمد للدراسة

يسمح المالك بـmigration218 لدورLOGIN مستقل بلا كلمة سر داخلSQL،وبلا
SUPERUSER/CREATEROLE/CREATEDB/REPLICATION أو عضويات إدارية. يمنحSELECT
المحدود،وBYPASSRLS عند الحاجة،بعد إثبات القراءة الكاملة والمنع الفعلي للكتابة
وDDL وEXECUTE للكتّاب. يضع المالك كلمة السر لاحقاً بإدخال مخفي وأمرمحروس.
لا يجوز أن يدخلpostgres إلىGitHub كبديل عن فشل هذا الإثبات.

218 لم تُنشأ بعد:قبول الدور يعتمد على نجاحcomplete dump والاسترجاع الدقيق
وفحوص الكتابة المباشرة وغير المباشرة. عند النجاح يرتفع السقف والترقية والنسخ
والحارس والتصفير والمرجع معاً فيPR47؛لا يُرفع السقف بملفشكلي.

## ما ثبت وما لم يثبت

- استُعيدworktree من لقطةCodex `3c581be` على الفرع `f6081a9` باعتماد
  المالك؛الفروق ثلاثةملفاتTask/state معروفة. نجحpreflight وresume.
- `pg_read_all_data` وحده مرفوض فيdump جداولRLS،كما أثبت الاختبار السابق217.
- جردفرانكفورت216 المحفوظ محلياً يظهرPUBLIC DELETE على
  `cron.job_run_details` وPUBLIC EXECUTE علىschedule/unschedule،والمالك
  `supabase_admin`. لذلك لا نفترض أنBYPASSRLS معpg_read_all_data دوربلاكتابة.
- تجربةcustom-role الجديدة قاعدةSupabase217 اصطناعية فقط؛تُنشئ دوراً بلا
  كلمةسر،وتختبرSELECT المحدود والكتابة وDDL وdump ثم أثرالدورالقرائي الواسع.
  إعادةتمثيلPUBLIC grants تتم علىالنسخةالمعزولة فقط،وليستSQL مقترحاً لفرانكفورت.
  نجاحالتجربة يعني اكتمالالتشخيص؛لا يعني قبولالدور للإنتاج.
- Docker المحلي تعطل بسبب`sailor-ingest.sock`؛فشلت إعادةتشغيله بلاfactoryreset.
  رُفضت آلياً محاولةحذفsocket ولم يُحذف. لذلك لم يُدعَ نجاحتجربةcustom-role محلياً.
- workflow `Nawasrah backup reader feasibility` تشخيصCI بلاأسرار ولاجدولة
  ولاوصول لأي مشروع. لا ينسخفرانكفورت ولايرفعR2؛يرفعJSONمنقحاً فقط.

## بوابة القرار التالية إن ظهر تعارض

لا نُسقطcron أوAuth أوStorage أوأي بيانات منالنسخة،ولا نضع استثناءACL
ولا نعتمدdefault_transaction_read_only كبديل عنمنع الصلاحية. إناحتاج
تحقيق الدور إلىتغيير أوسع فيحقوقPUBLIC أوتصميم تصديرمنصة إضافي،يُعرض
السبب والخيارات قبل تنفيذه؛لا تتوسعmigration218 تلقائياً.

## المراجع

- [Supabase:مخاطرالدورالقرائي وcron وحدودREVOKE](https://supabase.com/kb/troubleshooting/revoking-privileges-on-storage-pg_cron-vault-and-extension-objects-has-no-effect).
- [Supabase:إنشاء دورBYPASSRLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
- [PostgreSQL17:الدورالقرائي وRLS](https://www.postgresql.org/docs/17/predefined-roles.html).
