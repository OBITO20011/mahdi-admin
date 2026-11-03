# مراجعة CREATE EXTENSION حتى219

اعتماد المالك3نوفمبر:الاستبدال RESET219 فقط ولثلاث عبارات pg_cron؛لا تغيير للبناء من الصفر أوmigrations أوبقية الامتدادات. مراجعة محلية على الأرشيف الحقيقي219 وبقيمSupautilsالمصدر الـ22،كل عبارة منفردة داخلrollback ومقارنةكتالوجكامل قبل/بعد. لا اتصال بالخدمات.

|الملف|السطر|العبارة|الفرق داخلrollback|
|---|---:|---|---|
| `001_initial_schema.sql` | 7 | `CREATE EXTENSION IF NOT EXISTS "pgcrypto";` | لا فرق كتالوج |
| `008_purchase_orders.sql` | 7 | `CREATE EXTENSION IF NOT EXISTS "pgcrypto";` | لا فرق كتالوج |
| `009_direct_goods_receiving.sql` | 6 | `CREATE EXTENSION IF NOT EXISTS "pgcrypto";` | لا فرق كتالوج |
| `010_warehouse_completion.sql` | 10 | `CREATE EXTENSION IF NOT EXISTS "pgcrypto";` | لا فرق كتالوج |
| `011_supplier_receiving_hardening.sql` | 7 | `CREATE EXTENSION IF NOT EXISTS "pgcrypto";` | لا فرق كتالوج |
| `033_order_web_push_notifications.sql` | 12 | `CREATE EXTENSION IF NOT EXISTS pg_net;` | لا فرق كتالوج |
| `033_order_web_push_notifications.sql` | 13 | `CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;` | لا فرق كتالوج |
| `033_order_web_push_notifications.sql` | 14 | `CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;` | لا فرق كتالوج |
| `091_expire_stale_new_website_orders.sql` | 211 | `CREATE EXTENSION IF NOT EXISTS pg_cron;` | ACL cron.job_run_details فقط |
| `097_core_business_alerts.sql` | 628 | `CREATE EXTENSION IF NOT EXISTS pg_cron;` | ACL cron.job_run_details فقط |
| `098_business_summaries.sql` | 718 | `CREATE EXTENSION IF NOT EXISTS pg_cron;` | ACL cron.job_run_details فقط |

عباراتpgcryptoالست وpg_net وsupabase_vault لم تظهر الأثر نفسه وبقيت دون استبدال. كل مقارنة بعدrollback متطابقة. pg_cronالموجود1.6.4/schema pg_catalog/owner supabase_admin؛المنحةt* ناتجةعنafter-createفيالصورةوتتكررمعIFNOTEXISTS. الحراسة تقرأالهوية قبلالحذفوتتحققعندكلعبارةمعتمدة،وترفضغيابها/اختلافها.

دليل التشغيل الخارجي:ALL_CREATE_EXTENSION219_AUDIT.json داخلNawasrahFrankfurt/go-live-rehearsal219-local-20261102؛180لقطةسابقةوfile-isolationثلاثي موثقانفيPG_CRON219_CAUSAL_DIAGNOSIS.json. لاتتضمنالوثيقة بياناتصفوفأوأسراراً،ولا تدعي تشغيلالخادمالحي.
