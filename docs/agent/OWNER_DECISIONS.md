# Approved owner decisions

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
