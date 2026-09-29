# Phase 5 Slice 1 object map

Status: implementation map frozen before Migration 123 was authored.

This slice is additive, private, inactive, and backward-compatible. None of the
objects below is an authoritative reader or writer until a later, separately
approved activation boundary.

| Object / change | Purpose | Approved contract implemented | Visibility | Current runtime impact | Dependencies | Rollback characteristic | Required proof |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `phase5_private` schema | Keep future financial evidence outside the exposed `public` schema | Private/inactive foundation and no PostgREST surface | Private; no `USAGE` for `PUBLIC`, `anon`, `authenticated`, or `service_role` | None | PostgreSQL schema namespace | Transactional creation in Migration 123 | Catalog ACL and PostgREST/OpenAPI absence |
| `phase5_private.financial_operation_events` | Immutable committed operation/request/result identity | Actor-scoped idempotency, immutable request fingerprint, separate operation types, one explicit server event time | Private | None | `public.profiles` | Transactional table creation; append-only guard | Scoped uniqueness, type/result binding, no `DEFAULT now()` for `operation_event_at` |
| `phase5_private.collection_events` | Future canonical committed Cash/CliQ collection evidence anchored to the existing exact payment | Collection is durable evidence; debt/COD is not collection without payment evidence; no invented tender | Private | None | financial operation event, `customer_payments`, order, customer, shift | Transactional table creation; append-only guard | Exact operation/type/time FK, original-payment uniqueness, positive amount, CliQ reference |
| `phase5_private.payment_reversal_events` | Future separate full reversal evidence for one exact collection/payment | Original evidence remains immutable; full exact-payment reversal; actual reversal tender is independent | Private | None | financial operation event and collection evidence; order/customer/shift | Transactional table creation; append-only guard | Composite FK enforces original identity and exact amount; one reversal per collection; Cash shift/CliQ reference rules |
| `phase5_private.assert_collection_source()` | Bind future collection evidence to the exact immutable fields of its `customer_payments` anchor | Canonical evidence cannot relabel Card/Bank/Cheque as Cash/CliQ or change actor/order/customer/shift/amount/reference | Private `SECURITY INVOKER`; no executable grant | None; called only by a trigger on the new collection table | New operation table plus existing payment row; no source-unknown-owner function | Transactional function/trigger creation | Exact source comparison and unsupported-tender rejection |
| `phase5_private.reject_financial_evidence_mutation()` | Reject UPDATE/DELETE on Slice-1 evidence | Immutable committed history | Private `SECURITY INVOKER`; no executable grant | None; only new-table triggers call it | New Slice-1 tables only | Transactional function/trigger creation | Explicit owner/security/search path/ACL; mutation rejection |
| Four explicit new-table triggers | Bind collection inserts and apply immutability at shared boundaries | Exact payment source plus immutable historical evidence | Private; all four explicit/application triggers attach only to new tables | No current business-path impact | New guard functions | Transactional trigger creation | Zero explicit business/application triggers on existing operational tables |
| PostgreSQL internal FK triggers | Enforce the 11 new foreign keys in both referencing and referenced directions | Referential integrity for exact operation, payment, order, customer, shift and collection identities | Database-managed internal triggers, not callable business writers | 44 internal triggers total: 28 on new Slice-1 tables and 16 on existing referenced tables. With the inactive foundation empty and unreachable from current writers, current business output is unchanged. Future evidence rows intentionally prevent incompatible update/delete of their referenced anchors. | The 11 foreign-key constraints declared by Migration 123 | Removed transactionally with the new constraints/schema before activation | Catalog identity/count, `tgisinternal`, owning FK constraint, and trigger-function namespace prove these are referential-integrity triggers rather than project business triggers |
| Reconstruction indexes | Prepare future order/time and original-payment lookup without activating projections | Future collection coverage and tender reconstruction support | Private | None | New Slice-1 tables only | Transactional index creation | Exact index definitions; no existing-table index/change |

Deliberately omitted from Slice 1:

- no public RPC or view;
- no active reconstruction/report function, because a partial foundation-only
  projection could be mistaken for current authority;
- no current payment/Return/Shift/report caller migration;
- no explicit business/application trigger, declared constraint, index, or ACL alteration on an existing operational table; PostgreSQL creates 16 internal referenced-side FK triggers on existing tables for the new outbound foreign keys, and those internal triggers do not provide a write path into the foundation;
- no writer that captures `operation_event_at`; the future writer must capture it
  after locks and validation and supply the same value to all related rows;
- no owner/global ACL convergence and no dependency on source-unknown-owner
  functions.
