# Nawasrah Business Manager - Supabase Phase 1 Setup

تتضمن هذه المجلدات ملفات التهيئة البرمجية وقواعد البيانات الخاصة بـ **المرحلة الأولى (Phase 1)** لنظام **Nawasrah Business Manager**.

---

## 📁 قائمة الملفات المنشأة

1. `supabase/migrations/001_initial_schema.sql`:
   - جداول النواة الأساسية: `profiles`, `roles`, `user_roles`, `branches`, `warehouses`, `categories`, `brands`, `units`, `products`, `product_images`, `inventory_balances`, `inventory_movements`, `audit_logs`.
   - القيود (Constraints): UUIDs، أسعار أعداد صحيحة بالفلس (Minor Units)، قيود منع الكميات والأسعار السالبة، والإنشاء التلقائي لـ `updated_at`.

2. `supabase/migrations/002_rls_policies.sql`:
   - تفعيل حماية Row Level Security (RLS) على كافة الجداول الـ 13.
   - منع التعديل المباشر لرصيد المخزون (`inventory_balances`) وحركات المخزون (`inventory_movements`) من الواجهات الأمامية.

3. `supabase/migrations/003_inventory_functions.sql`:
   - دالة RPC الذكية `create_product_with_opening_stock`: لإنشاء المنتج وربطه بالمستودع وتسجيل الرصيد الافتتاحي وحركة المخزون وسجل التدقيق داخل معاملة ذرية واحدة (Atomic Transaction).
   - دالة RPC الذكية `receive_inventory`: لاستلام وتزويد كميات المخزون وتسجيل حركة الشراء وتحديث الرصيد وسجل التدقيق بشكل آمن.

4. `supabase/seed.sql`:
   - بيانات أولية تجريبية تتضمن: الفرع الرئيسي (عمان - خلدا)، المستودع المركزي الرئيسي، الأقسام (شوكولاتة، شيبس، مشروبات، بسكويت)، الوحدات (قطعة، باكيت، كرتونة)، والأدوار الوظيفية للنظام.

---

## 🚀 ترتيب وتشغيل الملفات في Supabase

> **ملاحظة مهمة:** هذه الملفات موجودة الآن جاهزة داخل مشروع الكود المصدر، **ولم يتم تنفيذها تلقائياً على قاعدة بيانات Supabase الخارجية**.

### طريقة التطبيق عبر Supabase Dashboard (موصى بها):

1. افتح مشروعك في [Supabase Dashboard](https://supabase.com/dashboard).
2. انتقل إلى قائمة **SQL Editor** من الشريط الجانبي.
3. أنشئ استعلام جديد وسجل محتوى الملفات بالترتيب التالي بالظبط:
   - **الخطوة 1:** نفّذ محتوى `supabase/migrations/001_initial_schema.sql` (انقر على Run).
   - **الخطوة 2:** نفّذ محتوى `supabase/migrations/002_rls_policies.sql` (انقر على Run).
   - **الخطوة 3:** نفّذ محتوى `supabase/migrations/003_inventory_functions.sql` (انقر على Run).
   - **الخطوة 4 (اختياري):** نفّذ محتوى `supabase/seed.sql` لإضافة البيانات الأولية للفرع والمستودع والأقسام والوحدات.

### طريقة التطبيق عبر Supabase CLI:

```bash
# تسجيل الدخول وربط المشروع
supabase login
supabase link --project-ref your-project-ref

# تطبيق جميع الهجرات التلقائية والـ Seed
supabase db push
supabase db reset # لتطبيق الهجرات والـ Seed من جديد
```

---

## 🔒 الضمانات والشروط المتوفرة:
- البيانات التجريبية التطبيقية (Mock Data) **لم تُحذف** ومستمرة بالعمل في التطبيق حالياً.
- واجهات التطبيق **لم تُربط بالجداول مباشرة بعد**، حتى تتاح لك الفرصة لمراجعة وتأكيد ملفات الـ SQL.
