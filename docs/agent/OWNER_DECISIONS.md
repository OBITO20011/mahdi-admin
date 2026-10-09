# Approved owner decisions

## Package E closure and next boundaries — 2026-10-08

- **Package E = OWNER-CLOSED** بقرار المالك بعد مراجعة التصحيحات: البنود1–10 وإضافاتUX FIXED، لا Critical/High جديد،001–132 unchanged. الأساس `5bb5c8877978ee4cb1b0a0de9d516d25d319d617`؛ exact push/main code quality37786962873 ناجح15/15 وsecret scanning37786962944 ناجح. لا إعادة فتحها بسبب المؤجلات أدناه.
- **إلىPackage F (B):** ربط تأكيد إلغاء السند بمجموع الدفعات المتوقع/بصمة تمرر إلىRPC، ورفض عند الاختلاف. **(C):** `receive_purchase_order_v2` يعيدDETAIL رفض الدفع (المستحق/المدفوع/الحد) نفسه، وتقريب رسالة `record_supplier_payment` إلى `round(x/1000.0,3)`؛ لا سياسة مالية جديدة.
- **بعد التسليم (A):** نسخة من `phase133_legacy_po_payables_internal` تستقبلPO id وتفلتر داخلياً بدل حساب كل الأوامر مع كل دفعة؛ غير منطبق على مشروعSupabase الجديد بلاPO V1 قديمة. تحسين الأداء السابق في POST_DELIVERY.md باقٍ كما هو.

### قرارات Phase7 من المالك — تسجيل فقط

1. مشروعSupabase جديد في فرانكفورت على الخطة المجانية، مبني001–134، بدل تنظيف القديم؛ حذف القديم فقط بعد التحقق. لا حذف أو إنشاء مشروع أو نقل بيانات الآن.
2. نشرEdge Functions `submit-guest-order` و`admin-ai-assistant` مع قاعدة البيانات، ضمن النشر المعتمد لاحقاً.
3. نقل مهام النسخ الليلي إلى جهاز دائم التشغيل في المحل.
4. تنبيهTelegram عند اقتراب حجمDB من400MB.
5. تقييد/تنظيف روابط معاينةCloudflare Pages.
6. تحويل مستودعGitHub إلىخاص يوم التسليم؛ لا تغيير رؤية المستودع الآن.

### حزمة بداية التشغيل — بعدF وقبلPhase7، غير منفذة

- رصيد افتتاحي للعملاء والموردين: للمالك فقط، خارج المبيعات والمشتريات والمخزون والربح؛ أول سطر في الكشف، وأقدم دين في العمر، مع سجل تدقيق وتصحيح بقيد عكسي لا تعديل الدليل الأصلي.
- استيرادExcel للأرصدة والجرد الافتتاحي: نموذج، مطابقة بالباركود/SKU، تحقق لكل سطر ومعاينة قبل الاعتماد.
- التحقق من أداة الجرد الافتتاحي047 مع الباكيت والكرتونة والنكهات وWAC؛ لا استبدال أو تعديل الأداة ضمن هذا الإغلاق.

هذه قرارات نطاق مستقبلية وليست تفويضProduction/deploy أو تنفيذPackage F الآن. Claude سيبني أساسtokens والخط وAppShell والمكونات المشتركة ويرسل المواصفات؛ Codex يتوقف بعدcommit التوثيق وCI أخضر. الفقرات التالية قرارات/قياسات تاريخية، والتوقيت الحالي لتحقق المراقبة هوكل6 ساعات معcache حسب134 المغلقة؛ قارئ حالة السلامة الضيق لأدوار التقارير يحل محل قراءة لوحة المراقبة الكاملة من الواجهة.

## Package E read performance — 2026-10-08

تحقق أدلة المرتجعات والاستبدالات إلزامي عند الكتابة؛ القراءات (الرئيسية والتقارير والملخصات) بدون إعادة تحقق؛ بديل الأمان فحص مراقبة يومي لآخر 7 أيام مع تنبيه Telegram وشريط تحذير في التقارير.

134 explicitly redefines report/summary readers with `p_verify_evidence=false`;
write validation in121/122/132, equations and privileges remain unchanged.
The existing monitoring scanner/incident/Telegram pipeline owns the strict
seven-day check; report JSON remains unchanged and the report UI reads the
existing monitoring dashboard (unavailable access fails closed to a warning).
Missing, failed or older-than24h checks warn. Full-history verification is a
manual Phase7 rehearsal requirement, not authorized to execute now.
Final E2 stress performance is owner-accepted on 2026-10-08: home p95=2.367605s,
monthly report=4.085672s and daily report=3.461212s on150k orders with5000 modern
Returns concentrated in one day. Measured threshold misses remain documented;
no further reader optimization or changes to131/the facts reader are authorized now.
One deferred improvement, with targets and JSON-parity protection, is recorded in
`POST_DELIVERY.md`. Final golden day, quality, Gitleaks0 and exact-SHA CI precede E3.

These are business decisions, not implementation suggestions.

## Commerce vocabulary

- Sales Parcel and Purchase Package are distinct. Sales Parcel is commercial; supplier receiving uses Base Unit/Purchase Package and inventory remains at Base Unit SKU/Flavor level.

## Promotion redemption

- Cancel/expiry before Completion restores quota/eligibility.
- Partial or full Return after Completion does not restore automatically.
- Compensation uses a new replacement promotion/coupon.
- Policy is approved; implementation may remain deferred by approved scope. Do not reopen the decision.

## Return/refund financial policy

- For partially paid sales, reduce the outstanding debt first using authoritative execution-time debt and net collected amount for that sale. Refund only the remaining entitlement backed by money actually collected.
- Delivery is a separate service and is not automatically refunded or prorated on merchandise Return. A full merchandise Return may leave a delivery balance.
- Tax treatment must not be invented where still outside an approved implemented contract.
- Retry of one Return must not repeat debt reduction or money refund.

## Parcel and damaged goods

- Sales Parcel Return/Refund is whole Parcel Instance only.
- Settling a Parcel Return consumes that Parcel identity as Return entitlement, including when components are rejected for `CUSTOMER_DAMAGE`; accepted/rejected quantities and reasons remain evidence.
- Customer-damage deduction equals rejected quantity times the immutable historical **effective standalone Base Unit sale price** at the authoritative price-freeze point. Never use current price, current offer, Parcel allocation, COGS, or WAC. Clamp deductions to the original Parcel refundable entitlement.
- POS captures that snapshot at sale. Customer V2 captures it when commercial price/composition is frozen; Completion only starts the Return window and does not reprice it.

## Replacement lineage

- Customer replacement stock comes from sellable inventory; the damaged unit does not return to sellable inventory.
- Supplier claim/replacement/credit is a separate later operation and no Supplier Credit is created merely by storing defect evidence.
- Replacement does not restart the 48-hour window. Eligibility is anchored to original authoritative Completion.
- A defective replacement may be replaced again only within that original window and with lineage to the original unit.
- A current replacement can represent the original component in a later whole-Parcel Return; refund remains based on original-sale entitlement, not replacement cost.
- Replacement stock outflow gets its own cost snapshot under inventory policy and does not reinterpret original COGS.
- If that replacement is the current physical representative in a later Return, sellable restock valuation uses its immutable replacement-time cost snapshot. Current WAC is not a Return valuation source, and lineage consumption must not consume the original source twice.

## Deadline

### Phase 6 Base Return allocation (owner approved 2026-10-06)

For a selected partial Base Return, original `base_order_item` capacity is allocated first.
Operational replacement leaves follow issuance date oldest-to-newest, then lineage depth,
then sourceId as the final deterministic tie-breaker. If issuance dates are incomplete,
use lineage depth then sourceId. Only the existing public aftercare read facts are used;
incomplete or contradictory lineage fails closed. This does not change DB valuation,
capacity, entitlement or current-leaf authority.

- A new operation is allowed when authoritative DB time is `<= completed_at + 48 hours` after locks are acquired and state is revalidated.
- Opening UI does not reserve eligibility.
- Exact same-key replay of an already committed operation returns its stored result even after the deadline.

## Accounting scope

### Package E closing sales presentation (owner clarified 2026-10-07)

Cash/CliQ sales fields, shift counters, payment vouchers and drawer calculations
remain unchanged. Show initial completion payments recorded as vouchers as a
separate sales line (with tender), and annotate collections with its included
amount. New credit sales are the portion unpaid at completion, not current debt
after subsequent payments/returns. Gross = existing Cash/CliQ sales + initial
voucher payments + unpaid-at-completion credit. Never add those initial payments
again to total inflows. Closed historical snapshots stay byte-identical. The
owner authorizes this live reader and Admin presentation in uncommitted133.

Closing net sales = gross minus settled merchandise Return entitlement
(monetary refunds + debt reduction). Present both components separately: the
golden day is67 - (12 +3) =52. Debt reduction is never drawer outflow or a
second refund. This reader-only correction in133 must preserve vouchers,
reconciliation and every old closed snapshot. Stop at any fourth numeric gap.

### Package E supplier balance (owner approved 2026-10-07)

Supplier balance equals active direct and PO receipts minus every active payment.
PO advance payment creates supplier credit (negative balance) until receiving.
Payment, receiving-time payment, reversal and receipt cancellation apply each
movement once. Updated owner correction authorizes133 to recalculate every
supplier once from receipt/payment evidence with old/new audit, replacing the
earlier no-backfill limitation. Production remains off limits. Legacy PO V1
without a payable snapshot uses recorded receipt cost only. Exact fully received,
non-cancelled matching PO/item receipts use final net PO payable once, without
per-receipt allocation. Partial/price-mismatched adjusted POs retain recorded
cost and an audited manual-review flag/potential difference. V2 snapshot113
is unchanged; the rehearsal count query is read-only and not run on Production.

Owner option1: new receiving uses V2 only and never saves product defaults or
sale/default-sale prices. Defaults stay in the existing product editor; WAC/cost
changes remain in the existing helper. New PO payments are capped at PO payable.
Positive supplier debts and negative advances are reported separately.134 is
authorized after133 for the two operation_id indexes and home-only evidence
verification=false; monthly/daily remain strict and p95>3s stops for review.

- Planned Phase 5 scope is reversal, operational accounting integration, reports/profit/payment reconciliation.
- Double-entry General Ledger and Balance Sheet are optional/deferred, not required to close the core project.

### Package F admin redesign (owner approved 2026-10-08)

The owner approved the 14-screen design and Package F scope ("معتمد"):
tokens/self-hosted IBM Plex Sans Arabic/light+dark, desktop SideNav, phone
BottomTabBar with a centre Sell button (Customers moves to More), screens
Home/Orders/POS/Inventory/Cash/Customers plus a read-only debt-aging reader,
remaining screens on the same components. Deferred after handover: in-admin
notification centre with routing matrix and customer WhatsApp reminders.
Spec and reference screens: docs/design/package-f/. The owner authorized
Claude to build and commit/push the foundation (F1–F3) after full quality,
Gitleaks0 and exact-SHA CI; screen migration follows by Codex. No money,
RPC, permission or migration change is part of the foundation.

### Package F read extensions135 — owner2026-10-09

After accepting Inventory f8d88ac,the owner approved135 as a separate read-only
commit:POS balance/credit limit from the same CRM source,display-only warning
without sale blocking;inventory available_quantity>0 across scoped whole catalog,
active-SKU count as a new field preserving total_items. Hide unsupported row
valuation,remove quantity emoji,label reorder units. Explicit bodies,no new
wrappers,identical grants/search_path/roles.001–134 unchanged,pinned135,real
JSON/ACL/debt/payment/Return proof,p95<1s on E-scale,quality/Gitleaks0/exact-SHA
CI and STOP for visual review. No Production/deploy or new screen.

### أسئلة مفتوحة — 2026-10-09

- هل يبقى حقل «الكاش الفعلي» معبّأً بالمتوقع أم يبدأ فارغاً ليجبر الكاشير على العدّ؟
  السؤال فقط؛ السلوك الحالي لم يتغير، ولا قرار مفترض بشأنه.
- عمر الدين: إذا احتسب قارئ الرصيد طلباً قديماً مكتملاً بلا تاريخ إكمال مثبت،
  هل يُعرض الجزء غير المؤرّخ منفصلاً «عمر غير متاح»، أم تُرفض قراءة العمر
  لهذا العميل؟ لا يُستخدم تاريخ الإنشاء/التعديل كتاريخ إكمال دون قرار.
  مصدر الفجوة:121 يحتسب كل دين completed/delivered، بينما131 يؤرّخ بأول
  حدث completed و120 يتطلب دليل الإكمال الحديث.136 لم تُكتب قبل القرار.
