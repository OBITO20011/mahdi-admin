# دليل نظام العملاء والطلبات - Nawasrah Business Manager

هذا المستند يشرح الهيكلية البرمجية، ودورة حياة الطلب، والإجراءات المخزنة (RPCs) الخاصة بنظام العملاء والطلبات وإدارة المخزون الذرية.

---

## 1. ترتيب تشغيل ملفات الهجرة (Migration Execution Order)

عند تهيئة قاعدة بيانات Supabase من الصفر، يجب تنفيذ ملفات الـ SQL بالترتيب التالي:

1. **`supabase/migrations/001_initial_schema.sql`**
   - ينشئ الجداول الأساسية (الملفات الشخصية، الأدوار، الفروع، المستودعات، التصنيفات، العلامات التجارية، الوحدات، المنتجات، صور المنتجات، أرصدة المخزون، حركات المخزون، وسجل التدقيق).

2. **`supabase/migrations/002_rls_policies.sql`**
   - يفعل حماية الصلاحيات والأمان على مستوى الصفوف (Row Level Security - RLS) لكل الجداول.

3. **`supabase/migrations/003_inventory_functions.sql`**
   - ينشئ دوال الاستلام وإضافة المنتجات الذرية (`create_product_with_opening_stock` و `receive_inventory`).

4. **`supabase/migrations/004_customers_orders.sql`** (الجديد)
   - ينشئ جداول العملاء، عناوين التوصيل، الطلبات، عناصر الطلب، وسجل حالات الطلب.
   - يوفر الـ RPCs الأربعة الرئيسية لربط متجر الزبائن ولوحة تحكم الإدارة.

---

## 2. دورة حياة الطلب (Order Lifecycle)

تمر الطلبات بالحالات التالية (`status`):

```
       [إنشاء الطلب] 
            │
            ▼
        ┌───────┐
        │  new  │ ──► (حجز المخزون: reserved_quantity + qty)
        └───┬───┘
            │ ── (confirm_order)
            ▼
      ┌───────────┐
      │ confirmed │
      └─────┬─────┘
            │
            ▼
      ┌───────────┐
      │ preparing │
      └─────┬─────┘
            │
            ▼
      ┌───────────┐
      │   ready   │
      └─────┬─────┘
            │
            ▼
   ┌──────────────────┐
   │ out_for_delivery │
   └────────┬─────────┘
            │ ── (complete_order)
            ▼
      ┌───────────┐
      │ completed │ ──► (خصم نهائي: on_hand_quantity - qty ، تنقيص reserved_quantity)
      └───────────┘

   * في أي مرحلة قبل completed يمكن إلغاء الطلب عبر (cancel_order):
     cancelled ──► (تحرير المحجوز: reserved_quantity - qty دون المساس بـ on_hand_quantity)
```

---

## 3. الفرق بين حجز المخزون (Reservation) والخصم النهائي (Deduction)

- **عند إنشاء الطلب (`create_customer_order`)**:
  - يتم التحقق من أن الكمية المتاحة `available_quantity = (on_hand_quantity - reserved_quantity)` كافية.
  - يزداد `reserved_quantity` بمقدار الكميات المطلوبة.
  - **لا يتغير** `on_hand_quantity` في هذه المرحلة (المنتج ما زال في المستودع).

- **عند تأكيد الطلب (`confirm_order`)**:
  - تتحول الحالة إلى `confirmed`.
  - يظل المخزون محجوزاً دون خصم فعلي من الرصيد الموجود.

- **عند تسليم وإكمال الطلب (`complete_order`)**:
  - ينقص `on_hand_quantity` بمقدار الكمية المباعة.
  - ينقص `reserved_quantity` بمقدار الكمية المحجوزة.
  - تسجل حركة مخزنية في `inventory_movements` بنوع `sales_deduction`.
  - تتم حماية الدالة لمنع إكمال الطلب أكثر من مرة واحدة.

- **عند إلغاء الطلب (`cancel_order`)**:
  - ينقص `reserved_quantity` بمقدار الكمية المحجوزة (تحرير المحجوز).
  - **لا يتغير** `on_hand_quantity`.
  - يمنع إلغاء الطلب إذا كانت حالته `completed`.

---

## 4. أسماء الإجراءات المخزنة (RPCs) ومعاملاتها

### أ. `create_customer_order`
تُستخدم لإنشاء طلب جديد من متجر الزبائن أو التطبيق بشكل آمن.

- **المعاملات (Parameters)**:
  - `p_customer_full_name` (text, مطلوب)
  - `p_customer_phone` (text, مطلوب)
  - `p_customer_email` (text, اختياري)
  - `p_governorate` (text, اختياري)
  - `p_city` (text, اختياري)
  - `p_area` (text, اختياري)
  - `p_street` (text, اختياري)
  - `p_building` (text, اختياري)
  - `p_floor` (text, اختياري)
  - `p_apartment` (text, اختياري)
  - `p_address_notes` (text, اختياري)
  - `p_latitude` (double precision, اختياري)
  - `p_longitude` (double precision, اختياري)
  - `p_formatted_address` (text, اختياري)
  - `p_google_maps_url` (text, اختياري)
  - `p_location_source` (text, افتراضي `'manual'`)
  - `p_branch_id` (UUID, اختياري)
  - `p_warehouse_id` (UUID, اختياري)
  - `p_items` (JSONB, مطلوب، مثل: `[{"product_id": "...", "quantity": 2}]`)
  - `p_delivery_fee_in_minor_units` (bigint, افتراضي `0`)
  - `p_discount_in_minor_units` (bigint, افتراضي `0`)
  - `p_customer_notes` (text, اختياري)
  - `p_internal_notes` (text, اختياري)
  - `p_source` (text, افتراضي `'website'`)

- **النتيجة الراجعة**:
  ```json
  {
    "success": true,
    "order_id": "uuid...",
    "order_number": "ORD-20260723-12345",
    "subtotal": 15000,
    "total": 17000,
    "status": "new",
    "message": "تم إنشاء الطلب وحجز الكميات بنجاح."
  }
  ```

---

### ب. `confirm_order`
تأكيد الطلب وبدء معالجته في المستودع.

- **المعاملات**:
  - `p_order_id` (UUID, مطلوب)
  - `p_notes` (text, اختياري)

---

### ج. `complete_order`
إكمال الطلب وتسليمه للعميل وخصم المخزون النهائي.

- **المعاملات**:
  - `p_order_id` (UUID, مطلوب)
  - `p_notes` (text, اختياري)

---

### د. `cancel_order`
إلغاء الطلب وإرجاع الكميات المحجوزة.

- **المعاملات**:
  - `p_order_id` (UUID, مطلوب)
  - `p_notes` (text, اختياري)

---

## 5. كيفية اختبار النظام (Testing Guide)

يمكنك اختبار الإجراءات مباشرة من خلال **Supabase SQL Editor**:

```sql
-- 1. تجربة إنشاء طلب زبون جديد
SELECT public.create_customer_order(
  p_customer_full_name := 'أحمد النواصرة',
  p_customer_phone := '0791234567',
  p_governorate := 'عمان',
  p_city := 'عمان',
  p_area := 'خلدا',
  p_items := jsonb_build_array(
    jsonb_build_object(
      'product_id', (SELECT id FROM public.products LIMIT 1),
      'quantity', 1
    )
  ),
  p_delivery_fee_in_minor_units := 2000
);

-- 2. تأكيد الطلب
SELECT public.confirm_order(
  p_order_id := 'حط_معرف_الطلب_هنا',
  p_notes := 'تم الاتصال بالعميل وتأكيد العنوان'
);

-- 3. إكمال الطلب وخصم المخزون
SELECT public.complete_order(
  p_order_id := 'حط_معرف_الطلب_هنا',
  p_notes := 'تم التسليم وسداد المبلغ نقداً'
);

-- 4. أو إلغاء الطلب إذا لزم الأمر
SELECT public.cancel_order(
  p_order_id := 'حط_معرف_الطلب_هنا',
  p_notes := 'العميل قام بطلب الإلغاء قبل الشحن'
);
```
