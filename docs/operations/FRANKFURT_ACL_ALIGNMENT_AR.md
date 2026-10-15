# مواءمة صلاحيات فرانكفورت — أداة المالك فقط،2026-10-15

المالك أطفأAutomatically expose new tables وحفظه وتحقق بعد إعادة التحميل؛
لا يسحب ذلك المنح القائمة. مصدرها المعتمد تفعيله عند الإنشاء،والمرجع
المختبر يعمل دون الزيادة. تقريرFRANKFURT_ACL_REVIEW_20261015.md دليل تاريخي.

## الأمر الواحد

منTerminal داخل المستودع،بعد تغيير كلمة السر المكشوفة:

```powershell
node scripts/operations/frankfurt-align-acl.mjs --apply
```

يقرأ المجلد الخارجي `C:/Users/TOP/NawasrahFrankfurt/nawasrah-fra-001-138`
ويثبتmanifest138. يعرض أولاً الخطة منlocal-reference.json وcatalog-observed.json
(حالياً48 كائناً،279 أمرREVOKE دقيقاً). لمعاينةبلااتصال استعمل`--dry-run`.
قبل كلمة السر المخفية يطلب تأكيدالمرجع`kzevmysfydaslxcerogt`. الكلمة تبقى
فيذاكرةالعملية/child المؤقتة فقط،لاargv أوملف أوlog. لاlink أومشروعقديم.

بعد قراءةالكتالوج الحي يرفضACL_PREVIEW_STALE إن اختلفتACL عنالمعاينة.
معاملةSERIALIZABLE واحدة:قفلadvisory،مطابقةقبلية،REVOKE/GRANT لكلمنحة فقط،
ومطابقةبعدية تشملservice_role. لاCASCADE أوأوامرALL أوإصلاح تلقائي.
فشل قبلCOMMIT يعكس المعاملة؛فشل بعده يُذكرtransactionCommitted=true.
إن انقطع الاتصال قربCOMMIT فغياب التأكيد **لايثبتrollback**؛الرسالة
ACL_TRANSACTION_NOT_CONFIRMED تعني أن المالك يقرأالحالة بـ--verify-only
قبل أي محاولة أخرى،ولا إعادة تلقائية.
ثم يقرأالكتالوج مجدداً،يثبتservice_role كماكان،ويشغّل **نفس** تحقق
--verify-only بالتطبيع المعتمد وحجزtrigger/cron حرفياً.

المتوقع:ok=true،serviceRoleUnchanged=true،catalogUnexpectedDifferenceCount=0؛
والفرقالمسمّىpublic.orders.trg_notify_new_website_order_push:O→D فقط.
الأربعcron معطلة والـcleanup محفوظ. لاmigrations أوتفعيل أوأسرارإضافية.

كلتشغيل ينشئمجلدacl-alignment-<وقت> خارجGit:preview.sql،source-catalog.json،
post-alignment-catalog.json،catalog-differences.json وreport.json. لا يكتب
فوقlast-report.json أوlast-verify-report.json أواللقطة الأصلية.
يمكنللمالك لاحقاً إعادة
`node scripts/operations/frankfurt-owner-build.mjs --verify-only`
لإصدار تقريرمستقل جديد؛التحقق مضمّن أصلاً بأمرالمواءمة.

## حدودصارمة

- المقارنة كمنح(grantee/grantor/privilege/grant-option)،لا ترتيبمصفوفة.
  NULL فيproacl يعنيacldefault،لا «لا صلاحيات». تمثيلNULL مقابلتمثيلصريح
  لنفسمنحPUBLIC/المالك ليسامتيازاًجديداً؛لاUPDATE لكتالوجPostgres لإجبارNULL.
  تُسحب المنحالصريحةالزائدة لـanon/authenticated حتىلويرثانPUBLIC.
- استثناءservice_role بالمقارنة فقط؛لا أمر يستهدفه. كلدورآخر والمالك
  وSECURITY DEFINER وsearch_path لأكوادنا صارمة. مانحغيرpostgres أوكائن
  مفقود/زائد أوتغيرغيرACL يوقفالخطة. لا صلاحياتمنصة تُعدّل.
- CRLF→LF فقط فيfunction/trigger definitions وpolicy expressions؛لا إعادة
  صياغةSQL أوإزالةمسافات. ثبت34/34 تعريفاً منملفالمالك حرفياًبعدالتطبيع.
- المنصةالمعلوماتية المحددة:auth/storage/realtime/_realtime/extensions/
  supabase_functions/cron/net/vault/graphql/graphql_public. أي مخططآخر،ومنها
  public وphase5_private وsupabase_migrations،صارم. **كلسياساتRLS** وتغير
  rls/forceRls لجداولموجودة صارمة. لااستثناءلمخططجديدغيرمسمّى.
- pg_net0.20.4 مسجلةextensionsمحلياً وpublicبعيداً. يُسجلالفرق،ويُلزم
  توقيعnet.http_post(url text,body jsonb,params jsonb,headers jsonb,
  timeout_milliseconds integer) وRETURNS bigint. وجوده ليسإثباتتنفيذHTTP.
- فروقالمنصة تُحفظ فيplatformInformation والفروقالخاممحفوظة دائماً؛
  cron الخاصبنا يُفحص بأسماءوأوامرومواعيدوحقولوحالاتnotification-before.json
  لنفسالمشروع،لاjobids المحليةالمختلفة.

## الإثبات

عيناتالوحدة مأخوذةمنملفالمالك518فرقاً؛تثبتCRLF وservice_role ورفضanon
الحقيقي وREVOKE جدول/دالة/defaults وGRANT/خياراته وحراسالأمان. التجربة
المعزولة تفحص المعاملةوحارساللقطةوعكسكاملعندفشلالشرطالبعدي. محاكاة
279أمر/48كائناً أعطتصفراًغيرمتوقع؛**ليست**تطبيقاًعلىفرانكفورت. نتيجتها
الفعلية تنتظرأمرالمالك.139مؤجلة منفصلة و140–149 محجوزة للفرعالموازي.

إثباتمحلي2026-10-15:runtime-PsoO0N نجح07:03:53–07:05:34UTC (101.393s)
علىقاعدة138معزولة:مواءمةحقيقيةمعservice_roleثابت،صفرغيرمتوقعوحجزالإشعار
المسمّى،رفضلقطةقديمة،وrollbackكاملعندحقنGRANTيخالفسلامةالشرطالبعدي.
السجلفيTemp/nawasrah-acl-runtime-PsoO0N/runtime-report.json خارجGit.

عدم التراجع--verify-only:VjxQO0 نجح07:06:50–07:08:34UTC (103.375s):
حجز1فرقكتالوجي/5حالاتمسمّاة،رفضكتابةفيجلسةREADONLY،ورفضعمودمحلي
محقونمعحفظكلالتفاصيل،والكتالوجوالجدولةوالتقريرالأصليلمتتغير.

البواباتالمحلية07:15:27–07:19:01UTC:كل1056وحدةإدارة و191وحدةمتجرPASS،
ولنت/أنواعالمتجرPASS والملفاتثابتة؛لنت/أنواعالإدارةPASS بسجل07:09:35
مع3تحذيراتقديمة. فشلالسجلACTIVE_TASK>4096عولجباختصارهلا بتغييرالحارس؛
ثمأعيدتكلالوحداتبنجاح. تصريحنتيجةالمعاملةعندخطأالاتصالصار«غيرمؤكدة»
بدلاعتباركلانقطاعrollback؛اختبارثابت يحميذلك. Gitleaks/CIشرطالتسليم.
