# ARCHITECTURE.md - Nawasrah Business Manager System Architecture

## 📐 نظرة عامة على المعمارية (System Architecture Overview)

يعتمد تطبيق **مؤسسة نواصرة التجارية** على معمارية حديثة ومفصولة تميز بين واجهات المستخدم (UI Layer) وإدارة الحالة المركزية (State Management) والمنطق البرمجي للعمليات (Business Logic Layer) مع محاكاة كاملة للتزامن والعمل المحمول.

```
+-----------------------------------------------------------------------+
|                           User Interface (UI)                         |
|  [Dashboard] [OrdersCenter] [POSView] [ProductsView] [AccountingView] |
+-----------------------------------------------------------------------+
                                    |
                                    v
+-----------------------------------------------------------------------+
|                    Global Store & State Manager                       |
|                          (Zustand Store)                              |
|  - Active Orders & Stock Reservations                                 |
|  - POS Cart & Financial Accounts Ledger                               |
|  - Shift Balances & Audit Logs                                        |
+-----------------------------------------------------------------------+
                                    |
                                    v
+-----------------------------------------------------------------------+
|                       Business & Domain Logic                         |
|  - Atomic Stock Reservation Engine                                    |
|  - Financial Double-Entry Ledger Logic                                |
|  - Jordanian 16% Tax & Change Calculator                              |
|  - Offline Persistence & LocalStorage Sync                            |
+-----------------------------------------------------------------------+
                                    |
                                    v
+-----------------------------------------------------------------------+
|                        Data Layer / Persistence                       |
|  - Supabase PostgreSQL Schema & RPC Functions                         |
|  - RLS Policies & Audit Logs                                          |
+-----------------------------------------------------------------------+
```

---

## 🛠️ التقنيات والمكتبات المستخدمة (Tech Stack)

1. **Framework & Engine**: React 18, Vite, TypeScript Strict Mode.
2. **State Management**: Zustand مع Persistence Middleware للحفظ المحلي التلقائي.
3. **Styling & UI**: Tailwind CSS مع تصميم محاكي لـ iOS iPhone Dark Glass Layout، ودعم كامل للـ RTL.
4. **Icons**: Lucide React Icons.
5. **Database Ready Schema**: Supabase PostgreSQL with PL/pgSQL Atomic Locking.
6. **Testing Suite**: Custom In-App Automated QA Testing Suite.

---

## 🔒 مبادئ الفصل والأمان (Security & Clean Code Rules)

- **Unidirectional Data Flow**: يتم تعديل جميع البيانات حكراً عبر دساتير وقوانين `useAppStore`.
- **Decimal & Precise Math**: معالجة الحسابات المالية عبر تقريب محكم لتفادي أخطاء Floating Point.
- **Audit Logging**: تسجيل كل عملية جرد أو تعديل مخزون أو حجز طلب في جدول `auditLogs` مع اسم المستخدم والطابع الزمني.
