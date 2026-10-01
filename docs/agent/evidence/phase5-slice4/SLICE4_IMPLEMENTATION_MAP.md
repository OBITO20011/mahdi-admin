# Slice 4 private financial read / reconciliation candidate

Implementation authorized against `095245e6bd30d2f40850e8779232f806f2cd0beb`,
following the design confirmation stored in ACTIVE_TASK. Slice 4 is OWNER-CLOSED
after bounded independent read-only re-sign-off. Local baseline preparation is
in progress; commit/push and public activation are not authorized.

## Shared boundaries

- Migration 127 only adds postgres-owned SECURITY INVOKER private functions.
  All application schema/function access remains revoked. No public caller,
  writer, trigger, projection or historical replay is changed.
- A typed ownership graph inventories creation/completion, payments, financial
  operations and all children, Return headers/items/inspections/consumption,
  settlement/effects/movements and the physical lineage anchors. Fixed-point
  traversal is bidirectional. Missing children cannot hide their operation.
- Relevant nodes with no resolvable Order fail UNASSIGNABLE_EVIDENCE; contradictory
  reachable Orders fail INCONSISTENT_ORDER_OWNERSHIP. Assignable unrelated incomplete
  evidence does not contaminate an independent Order.
- Closed source/collection/reversal validators run only after total discovery.
  Return item entitlement/capacity is read-only validated against immutable sale
  roots, historical inspection and physical consumption, without running finalizers.
  Multiset physical identity checks use EXCEPT ALL, not aggregate substitution.
- Foundation draft operations already carry completed_at and structural success
  JSON at INSERT. Those are NOT operational settlement truth. Valid draft/cancelled
  parents with no finalized children/effects contribute zero settled money.
- Historical Return snapshots mean merchandise debt and refundable collections.
  Do not subtract delivery twice or recompute their allocation from today's debt.
- Exact numeric accumulation precedes checked BIGINT outputs. Coverage, entitlement,
  debt/delivery and refund backing are checked before deriving nonnegative capacity.
  Cash/CliQ customer movement follows the ACTUAL tender, not the original tender.
- All table-dependent functions are STABLE; scalar parsing/derivation is IMMUTABLE.
  Current reads use a calling-query snapshot. Separate calls reserve no capacity.
  Reconciliation diagnoses public projection drift but never repairs it.

## Verification boundaries

`test:phase5-slice4:runtime` creates a fresh isolated 001–127 stack, real POS and
Customer completions/payments, real private anchors/reversals and real Return RPCs.
Fault injection stays in rollback-controlled disposable transactions. Complete
content fingerprints accompany read/replay and corruption rejection.

The snapshot test temporarily wraps the facts function INSIDE the isolated DB:
it pauses after facts, observes PgSleep, commits a real concurrent collection, then
checks that derivation AND reconciliation retain the old complete snapshot while
the next standalone call sees the new one. The test-only wrapper is restored;
the production call graph is checked before and afterward. No test hook is shipped
in Migration 127.

Focused implementation checkpoint (2026-10-01): candidate Migration 127
`A2C9561EF071E959152D7DD06CAFC0F9BE933F18F845F4AE03D2B1A8971BE60D`
passed the fresh isolated 001–127 runtime: 17 recorded checks, including the
30-signature transitive catalog review before/after snapshot instrumentation,
real POS/Customer collection/reversal/Return contracts, capped/mixed Parcel
damage, subsequent collection after historical debt reduction, numeric JSON
type corruption, missing/extra Return inventory evidence, cancellation through
the supported internal helper, nine app-role denials and a concurrent committed
collection snapshot. Strict lint admitted only the documented historical
`p_transfer_date` compatibility warning. The isolated stack was cleaned up.

The scalar deriver avoids catalog-STABLE polymorphic JSON conversion: checked
integer/JSON text conversion preserves numeric JSON and true IMMUTABLE behavior.
Timezone-equivalent arithmetic was exercised. The snapshot lock proof inspects
real relation/tuple/advisory resources; a transaction's own virtual-XID lock is
not misclassified as a business lock. Rollback probes also fingerprint products.
Bootstrap only skips a redundant reset for a genuinely new volume; a reused
volume must reset and the empty auth baseline and 127 migration records are
asserted. No timeout, assertion, lint allowlist or business contract was weakened.

Focused static/continuity regression passed 32/32, full unit tests 659/659,
TypeScript and strict ESLint passed. Raw SHA-256 comparison of all migrations
001–126 matched the pre-implementation fingerprints. Earlier fixture failures
(unsupported direct cancellation and duplicate injection identities) were
corrected in the harness, not accepted as successful rejection proof.

Unchanged prior-slice regression subsequently passed: Slice 3's fresh 001–126
runtime recorded 25 axes (including measured race deadlock deltas of zero), and
Slice 2's fresh 001–125 runtime passed its six observed A-first/B-first
idempotency races, conflict rollback, Legacy coexistence and strict lint. These
are the closed writers' regression ceilings, not a substitute for the new
001–127 read-layer integration proof. Both stacks were cleaned up.

The final current candidate passed uninterrupted Canonical 11/11 (parent
1646143ms under the unchanged 1800000ms budget), full quality with Admin659/659,
Customer189/189 and Browser207 passed/51 intentional skips/0 failed, retries0 and
zero escaped Production requests. The bounded independent read-only review
recorded 12 runtime checks on a fresh isolated 001–127 schema, including actual
partial cross-tender Return, same-content zero-write reads, contradictory
entitlement/source and cancelled-consumption rejection, cross-order FK
protection, historical debt reduction followed by collection, unrelated
incomplete-Order isolation, nine role denials and the observed snapshot boundary.
Two preliminary probe attempts stopped at constraints and were not credited as
successful complete runs. Review findings/gaps were zero; the owner approved
closure. Full evidence and probe limitations are recorded in ACTIVE_TASK.

## Separate future activation obligations

Private readers do not authorize a public cutover. Public writers/guards/projections,
Shift summaries/reversals and grants still require the separately approved atomic
convergence boundary. Profit dimensions and report presentation remain separate;
this slice does not implement profit reporting, drawer totals or a General Ledger.

No Production, commit/push/deploy, or later-slice implementation is authorized.
