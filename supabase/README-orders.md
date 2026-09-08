# دليل الطلبات والحجوزات

هذه الوثيقة تلخص العقد التشغيلي الحالي. migrations والدوال والاختبارات هي
المصدر النهائي عند اختلاف أي وصف.

## مسار Customer Store

```text
public catalog/settings/offers
  -> customer cart
  -> bounded server cart snapshot
  -> Turnstile token
  -> submit-guest-order Edge Gateway
  -> private submit_guest_customer_order contract
  -> canonical create_customer_order transaction
  -> customer/address + order/items + inventory reservation + history
  -> receipt + random tracking token
```

- لا يستدعي المتصفح canonical order creation مباشرة.
- Gateway يتحقق من Turnstile وHMAC rate limits وidempotency.
- الأسعار والخصومات ورسوم التوصيل والمخزون تحسب أو تتحقق خادميًا.
- الحد الأقصى 50 line items في الواجهة والخادم.
- رقم الهاتف يستخدم للربط التجاري؛ UUID هو هوية قاعدة البيانات.

## دورة الحالة

```text
new -> confirmed -> preparing -> ready -> out_for_delivery -> completed
  |          |          |         |              |
  +----------+----------+---------+--------------+--> cancelled عند المسار المسموح
  |
  +--> expired فقط لطلب website/new الذي انتهت مهلة حجزه

completed -> returned عبر مسار المرتجع المدقق فقط
```

الحالات الفعلية: `new`, `confirmed`, `preparing`, `ready`,
`out_for_delivery`, `completed`, `cancelled`, `returned`, `expired`.

## حجز المخزون

- إنشاء طلب الموقع يرفع `reserved_quantity` ولا يخفض `on_hand_quantity`.
- confirmation/preparation/delivery يحافظ على الحجز.
- completion يخفض `on_hand_quantity` ويحرر الحجز ويسجل الحركة مرة واحدة.
- cancellation قبل الإكمال يحرر الحجز دون خصم فعلي.
- طلب `website/new` الجديد يحصل على `reservation_expires_at = created_at + 5
  hours`. Cron خاص كل خمس دقائق ينفذ batch bounded ويفشل مغلقًا عند mismatch.
- الطلبات التاريخية السابقة لم تحصل على expiry backfill تلقائي.
- idempotency والـrow locks تمنع duplicate order/release/deduction.

## التتبع العام

- `track_guest_order_by_token` يستخدم token عشوائيًا خاصًا بالطلب.
- fallback `track_guest_order` يحتاج رقم الطلب **مع** الهاتف؛ الرقم وحده لا يكفي.
- الرد العام لا يعرض العنوان أو اسم العميل أو الملاحظات الداخلية أو التكلفة أو
  الربح.
- refresh يجلب آخر حالة، ولا يوجد polling دائم غير ضروري.

## عمليات Admin

- قبول وتجهيز وتوصيل وإكمال وإلغاء الطلب تمر عبر RPCs المصادق عليها.
- تسليم website order وتسويته يستخدم contract موحدًا لتحديث المخزون والتحصيل
  Cash/CliQ أو الذمة داخل المعاملة المناسبة.
- تفاصيل الطلب تُجلب عند فتحه، بينما القائمة تستخدم server-side pagination
  وstable ordering وفلاتر خادمية.
- realtime يسبب targeted refresh ولا يعيد تحميل كامل التاريخ.

## الخصوصية والتنبيهات

- البيانات الشخصية تبقى داخل customer/order/address records المحمية.
- migration `102` تمنع الاسم والهاتف والعنوان والموقع والملاحظات من new-order
  Business automation payload.
- Web Push والتنبيه التقني لا يعرضان هوية العميل أو عنوانه.
- راجع [Privacy Data Map](../docs/operations/PRIVACY_DATA_MAP.md).

## الاختبار الآمن

لا تستخدم أمثلة SQL التي تنشئ طلبًا على Production. استخدم بيئة Supabase
معزولة وتشغيل الاختبارات الرسمية:

```powershell
npm.cmd run test:db:isolated
npm.cmd test
npm.cmd --prefix customer-web test
npm.cmd run test:e2e
```

أي اختبار يحتاج كتابة على Production يجب أن يكون read-only أو داخل transaction
تنتهي بـ`ROLLBACK` وبعد موافقة صريحة، ولا يستخدم بيانات عميل حقيقية كـfixture.
