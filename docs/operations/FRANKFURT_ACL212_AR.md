# إصلاح منح فرانكفورت212 وفجوة verify-only

**المسار الحالي للمالك:** استخدم `frankfurt-owner-acl212 -- --dry-run` ثم `--apply` وبعده verify-only212 من النسخة الرئيسية بعد دمج PR/CI، وفق [دليل الأمر](FRANKFURT_OWNER_ACL212_AR.md). لا حاجة للصق الملف الكبير. الأقسام التالية تحفظ تشخيص الطلب الأول؛ اختبارات PostgreSQL المعزولة والتحقق الكامل للأمر موثقة في الدليل الجديد. إصلاح دقة ميتاداتا حدود التسلسلات أبقى جمل REVOKE وأهدافها كما هي، دون تغيير المرجع أو sequence فعلية.

أُعد هذا الحل من ملفات المالك المحفوظة فقط. لم يتصل الوكيل بفرانكفورت، ولم ينفذ SQL، حتى على قاعدة محلية. التعديلات محلية في worktree `trial-owner-r`؛ لا commit أو push أو نشر في هذا الطلب.

## سبب الفشل والنتيجة الكاملة

تقرير `upgrade212-2026-10-24T09-35-30-196Z` يؤكد تطبيق212 وتسجيلها، ثم الفشل عند `repair-212`. أول assertion فاشل هو `assertReady210Catalog` الموروث داخل211 ثم212: قارئ الإيصال العام `get_public_pos_receipt` يحوي `service_role EXECUTE` فوق `anon + authenticated + postgres` المرجعية. ليست مشكلة بيانات أو حساب في212.

المقارنة العامة القديمة تستبعد service_role من ACL عند التطبيع. لذلك `unexpected:0` ونجاح verify-only القديم لا يثبتان تطابق هذه المنح. كان استدعاء assertReady الصارم في repair يكشفها، بينما verify-only يتجاوزه. أُصلح مسارا211 و212 باستدعاء فحص ACL عام صارم للتطبيق ثم assertReady الخاص بالإصدار، مع حفظ تفاصيل الفرق قبل الرفض. لم تتغير سياسة التطبيع التاريخية أو استثناءات مخططات Supabase.

الفحص الكامل للمرجع212 واللقطة بعد212 كشف **196 دالة و68 علاقة** بمنح زائدة:60جدولاً و8تسلسلات. المجموع **432 صلاحية service_role**، بلا grant option، وكلها ممنوحة بواسطة postgres. لا صلاحيات ناقصة أو زيادات لأدوار أخرى، ولا فروق أخرى في أجسام دوال التطبيق أو المالكين أو الإعدادات أو البنية. القائمة التفصيلية في `FRANKFURT_ACL212_ANALYSIS.json`.

الأمثلة الخمسة عشر في تحليل211 السابق كانت نطاق دوال209–211، وليست جرداً كاملاً لكل المنح القديمة في التطبيق. الملف الجديد يغطي public كله كما طلب المالك. **لا يسحب** منح service_role الموجودة في المرجع، ومنها منح بوابة الطلبات المشروعة وصلاحيات `TRUNCATE/REFERENCES/TRIGGER/MAINTAIN` على products، ولا PUBLIC المرجعية على دالتي النكهات. لا تغيير للمخططات التي تديرها Supabase أو default privileges.

## الملف الذي يشغله المالك

الملف `FRANKFURT_FUNCTION_ACL212_OWNER.sql` معاملة واحدة محروسة. قبل أول REVOKE يتطلب:

1. دور postgres وPostgreSQL17، وقفل الترقية734151139.
2. سجل174migration كامل ينتهي212، بالضبط كما في المرجع.
3. هوية كل556دالة و119علاقة في public، والمالك والإعدادات وبصمة الجسم، وبنية الأعمدة وACL أعمدتها وRLS.
4. قيود وفهارس وسياسات ومحفزات وتسلسلات ومخطط public وdefault privileges مطابقاً للحالة المرجعية، مع بقاء إيقاف محفز الإشعارات المعتمد.
5. كل منحة مرجعية موجودة، ولا زيادة سوى المنح المحددة في اللقطة. أي نقص أو زيادة غير معروفة أو تغيير جسم/بنية يرفض المعاملة قبل السحب.

بعدها يسحب الزيادات فقط بـ264جملة REVOKE محددة مع RESTRICT. لا GRANT أو CASCADE أو تغيير جسم دالة أو بيانات عمل أو تاريخ migrations. يعيد الفحص كله ويشترط التطابق قبل COMMIT. يقبل الملف إصلاحاً جزئياً سابقاً أو إعادة تشغيل بعد نجاحه، دون سحب أي منحة مرجعية.

انسخ الملف كاملاً للحافظة، وهو إجراء محلي فقط:

```powershell
Get-Content -LiteralPath 'C:\Users\TOP\.codex\worktrees\trial-owner-r\mahdi-admin\docs\operations\FRANKFURT_FUNCTION_ACL212_OWNER.sql' -Raw | Set-Clipboard
```

في SQL Editor الخاص بفرانكفورت `kzevmysfydaslxcerogt` بدور postgres، الصق الملف كاملاً وراجعه ثم نفذه بنفسك. المتوقع اكتمال المعاملة و**675صفاً، كلها `matches_reference=true`**. مجموع `removed_privileges` يساوي432 إن لم يكن قد أُصلح شيء، أو أقل عند إصلاح جزئي، أو صفر في إعادة التشغيل. لا تنفذ REVOKE منفردة. عند خطأ الحارس احتفظ بنصه؛ لا تتجاوز الحارس.

## الأمر بعد نجاح الملف

من هذا worktree تحديداً، فهو يحتوي تصحيح verify-only المحلي:

```powershell
Set-Location C:\Users\TOP\.codex\worktrees\trial-owner-r\mahdi-admin
npm.cmd run frankfurt-owner-upgrade212 -- --verify-only
```

المتوقع `ok:true` و`remoteWriteAttempted:false` و`catalogUnexpectedDifferenceCount:0` و`readyCatalogValidated:true`. يجب أن يحوي `application-acl-comparison.json` نتيجة `ok:true` و`differenceCount:0` وفحص556دالة و119علاقة. عند أي فرق ACL يُرجع `APPLICATION_ACL_MISMATCH` بدلاً من نجاح كاذب. تقرير جديد يُحفظ في مجلد أدوات المالك. لا إعادة لـ`--apply`؛212 مسجلة بالفعل. لا تشغّل أمر211 على قاعدة أصبحت212، لأن سجلها وكتالوجها يتجاوزان211.

## الأدلة وحدودها

- المرجع212: SHA256 `db0ad398c47c59d55e7cb47de4e0c3f51a616a2457bb927773a98a8e34c41f0c`؛ لم يتغير.
- اللقطة المرصودة: SHA256 `790a5d63e658187e4914262af309fa2d3c4e21915f26f256e495b9c230fc7558`؛ لم تتغير.
- فحص ملفات ومحاكاة الحارس: `FRANKFURT_ACL212_VERIFICATION.json`، يشمل نقص المنح، grantor/grant option، PUBLIC، الجسم وsearch_path، البنية، سجل ناقص/زائد، وإعادة التشغيل والإصلاح الجزئي. الرفض قبل السحب لا يغيّر الحالة في المحاكاة.
- اختبار عاملي verify-only الفعليين على لقطتي211 و212 بعمليات JavaScript تعيد JSON من الملفات فقط: `FRANKFURT_VERIFY_ONLY_ACL212_REGRESSION.json`. لا عميل قاعدة ولا تفسير أو تنفيذ SQL.
- لم يُجمّع ملف SQL أو يُنفذ داخل PostgreSQL؛ اختباره هنا بنيوي ومحاكاة مستقلة، والتنفيذ الفعلي للمالك فقط.

لإعادة فحوص الملفات محلياً دون اتصال أو SQL:

```powershell
node scripts/operations/verify-frankfurt-acl212-offline.mjs C:\Users\TOP\NawasrahFrankfurt\nawasrah-fra-001-138
node scripts/operations/verify-frankfurt-acl-readonly-offline.mjs C:\Users\TOP\NawasrahFrankfurt\nawasrah-fra-001-138
```
