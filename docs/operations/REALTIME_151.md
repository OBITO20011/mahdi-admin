# Realtime — قرار 151 وإثبات محلي (2026-10-15)

أُضيفت الجداول الثلاثة عشر المسماة في قرار المالك فقط إلى
`supabase_realtime`: customer_addresses، customers، inventory_balances،
inventory_movements، orders، products، purchase_order_items، purchase_orders،
purchase_receipts، supplier_payments، supplier_receipt_items، supplier_receipts، suppliers.
لا FOR ALL TABLES، ولا منح أو تغيير RLS. العضو الموجود يُتخطى، وتبقى خيارات
الـpublication وأعضاؤها السابقون كما هي. يُرفض publication من نوع ALL TABLES.

## الدليل الحقيقي

`npm run test:realtime151:runtime` يبني 001–139 و150 على Docker محلي، ثم
يطبق 151 بملفها الأصلي ويعيد تطبيقها. لا اتصال بمشروع مُدار.
تشغيل PN8ERE: 2026-10-15 14:19:09–14:20:50 UTC، ناجح.

- العضوية: 0 قبل / 13 بعد؛ الإعادة متطابقة.
- الكتالوج الكامل قبل/بعد متطابق: لا تغيير منح أو RLS أو دوال أو جداول.
- ثلاث قنوات WebSocket حقيقية، مع انتظار تأكيد جاهزية postgres_changes،
  وليس مجرد SUBSCRIBED الخاص بانضمام socket.
- طلب جديد عبر الكاتب العام create_pos_sale_v2: الموظف النشط صاحب دور ERP
  استلم INSERT واحداً لنفس معرف الطلب؛ authenticated بلا دور ERP: صفر بيانات؛
  anon: صفر بيانات. القراءة SQL بنفس claims: الموظف 1 / بلا دور 0.
- anon تلقى إطار رفض وحيداً `Error 401: Unauthorized`، وnew={} وold={}.
  لا يُسمى هذا استلام INSERT ناجحاً. المصنف يرفض أي حقل في إطار الرفض،
  وأي خطأ مختلف أو وصول بيانات لأي دور غير الموظف؛ اختبارات سلبية تثبت ذلك.
- مرجع الدوال مولد من سقف 151: 410 دوال، بلا تغيير تعريفاتها.

فحوص التشخيص الأولية كشفت متطلبات بنية الفحص لا الصلاحيات: استبعاد Auth
يحجب مفاتيح CLI المحلية؛ مطابقة اسم حاوية فضفاضة اختارت REST؛ انضمام socket
سبق جاهزية CDC؛ وأخيراً احتساب إطار الرفض الفارغ كصف كان خطأ في المصنف.
عولجت أدوات الفحص فقط، بلا منح إضافية أو تغيير RLS أو مهلات أو retries.
تظل التقارير الأولية والفاشلة في مجلدات Temp للتشخيص، وليست أدلة نجاح.

سلوك إطار الرفض موثق في [Supabase Walrus](https://github.com/supabase/walrus)
وتسليم البيانات المحكوم بـRLS في
[Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).

## هل يوجد polling بديل؟

لا polling دوري بديل لجلب بيانات الشاشات في src حالياً. توجد قراءة أولية،
تحديث يدوي/إعادة تحميل أو تبديل فلاتر وصفحات، وdebounce لأحداث Realtime.
مؤقت useAuthStore أمني، ومؤقت ReportsCenterView لساعة حالة السلامة، لا لجلب
الطلبات أو المخزون. لذلك publication فارغة كانت تمنع التحديث التلقائي.
لم يُضف polling في هذه المهمة.

## البوابة

الفحص الحقيقي خطوة إلزامية في مصفوفة package-f-reads الحالية، مع اختبارات
المصنف والعضوية والبصمة؛ لا رفع timeout ولا تغيير retry أو RLS. مقارنة العضوية
ستضاف كبيان مستقل مُبصم لمرجع 151، دون تغيير صيغة كتالوج 138 التاريخية.
