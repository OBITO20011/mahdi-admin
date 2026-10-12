# Customer statement — separate scope draft, 2026-10-12

Owner/Claude approves three phone tabs now:summary/orders/addresses. A real statement remains part of design§6.6,not a relabelled partial order list. Do NOT implement this reader during phone presentation work.

After the phone round:one separately scoped read-only migration,explicit function definition (136/137 pattern),postgres owner,pinned search_path and the same debt-reader roles/grants. No financial writes or parallel source. Timeline contains credit-sale liabilities,active payments,Return debt reductions and corrections/reversals from the existing phase42 evidence. Expose movement identity/type,time,amount and running balance;closing balance must exactly equal phase42_customer_receivable_total_internal for every customer. Preserve unavailable dates rather than guessing. Ordering,undated/opening evidence and pagination boundaries require a bounded contract before code.

Runtime:handwritten mixed movements/partial payments/Return/reversal cases plus per-customer phase42 equality over the full size fixture;exact ACL tests;read-only/replay proof and p95 measurements. Proposed target<1s for one customer's page,subject to owner approval of the final scope. Migration number/name assigned only when execution is authorized;001–137 unchanged now. No Production/deploy.
