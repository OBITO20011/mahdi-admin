# Phase status

| Phase | State | Durable outcome |
| --- | --- | --- |
| Phase 3 | OWNER-CLOSED | Configurable parcel receiving/sales, POS V2, Customer V2 lifecycle/checkout/recovery, Exact WAC and reporting integration verified. |
| Phase 4.1 | OWNER-CLOSED | Returns/refunds/replacement DB foundation and invariant/lock families independently signed off. Migration 120. |
| Phase 4.2 | OWNER-CLOSED | Atomic operational Return settlement, durable effect evidence, replay integrity, debt-first financial behavior and browser/DB isolation independently signed off. Migration 121. |
| Phase 4.3 | NOT STARTED | Requires explicit owner authorization and a read-only design/contract pass before implementation. |

Approved baseline: `c7e68e1ce419dbad8463dae0083a71a35d410a43` on `main`.

Do not reopen a closed phase merely because a later task touches an integration edge. Record direct evidence and bound the new work first. Do not declare a phase closed without an independent read-only sign-off and owner closure.
