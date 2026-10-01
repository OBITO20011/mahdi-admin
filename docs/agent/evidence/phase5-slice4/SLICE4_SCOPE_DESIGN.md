# Phase 5 Slice 4 — proposed private financial read model / reconciliation

Status: SOURCE-GROUNDED SCOPE PROPOSAL; ready for owner scope review, not an
implementation authorization or independent design sign-off. No Migration 127
has been created. Public activation and Production access remain prohibited.

Targeted design closure (2026-10-01): S4-DG1, S4-DG2 and S4-DG3 are defined
below for bounded independent confirmation. The earlier three-gap review is
preserved in `ACTIVE_TASK.json`. Definitions and source/arithmetic traces are
not PostgreSQL runtime proof or approval to implement this proposal.

## Verified baseline and continuity

Slice 3 is OWNER-CLOSED. `main` and remote `refs/heads/main` resolve to
`095245e6bd30d2f40850e8779232f806f2cd0beb`. GitHub push/main runs
`36808501724` (Nawasrah code quality) and `36808501743` (Nawasrah secret scanning)
were re-read as completed/success on that exact SHA. These are historical gates
for the committed candidate, not gates for this documentation change.

Migration 126 SHA-256:
`4C099804BA1D6B97DF6AF3FA0C0A8D514FD616397BDE1BC7F5E5DAE3EB8B1D21`.
Migrations 001–126 are frozen. Slice 4 implementation is NOT STARTED.

## Why this bounded next step

The existing roadmap does not define an approved detailed Slice 4 scope. This
proposal fills that planning step; it does not retrospectively label it approved.
Slices 1–3 provide private evidence, writers and a reversal coordinator. They do
not replace public collections, paid projections, aftercare financial readers or
Shift summaries. Activating only the coordinator would leave incompatible readers
and writers alive. The smallest proposed next capability is a private, zero-write
financial read/reconciliation layer, tested against the already-closed evidence.

Source anchors (paths relative to repository root):

| Current boundary | Repository evidence | Implication |
| --- | --- | --- |
| Private source population | `supabase/migrations/126_phase5_private_tender_coordinator.sql`, `collection_source_v1`, `discover_collection_population_v1` | Modern initial collection and explicit payments are distinct typed sources; partial Customer completion's linked payment counts once. |
| Historical reversal position | same file, `reversal_position_v1`, `validate_operational_reversal_v1` | Earlier replay uses its historical cutoff and independently validated membership; it is not a current financial-position API. |
| Operational tender movement | same file, `reversal_tender_movements`, `coordinate_payment_reversal_v1` | Actual reversal tender/Shift/time differs from source tender/Shift/time and evidence-anchor time. |
| Paid projection trigger | `043_sales_returns_and_refunds.sql`, `sync_order_payment_state`; trigger binding in `017_orders_customers_accounts.sql` | Completed non-debt orders can be forced back to full paid value; do not make a new reader trust this as canonical coverage. |
| Return financial position and payment guard | `121_phase42_atomic_return_coordinator.sql`, `phase42_order_financial_position_internal`, `record_customer_order_payment` | Currently reads `orders.amount_paid_in_minor_units`; must converge at future activation. |
| Existing once wrapper | `078_operational_accounting_integrity.sql`, `record_customer_order_payment_once` | Existing key lookup and response reconstruction are not permission to adopt the new private identity/replay contract implicitly. |
| Old reversal chain | `078_operational_accounting_integrity.sql`, reversal body; `120_phase4_returns_refunds_foundation.sql`, public reversal wrapper | Historical-Shift and `is_reversed` semantics remain separate from private compensating movements. |
| Shift summary | `078_operational_accounting_integrity.sql`, `get_cash_shift_summary` | Subtracts reversed receipts using original payment tender/Shift for open summaries; cannot simply add new reversal outflow on top. |
| Full-Shift reversal | `121_phase42_atomic_return_coordinator.sql`, `reverse_cash_shift_with_operations` | Existing settled Return dependency guard must remain; future canonical movement dependency must be reviewed. |
| Current client | `src/services/supabase/customerAccounts.service.ts`, `record_customer_order_payment_once` call | No client migration in this slice. |

The source-only pre-implementation authority ledger is a frozen through-122
artifact, not a proof of today's live privileges or a complete through-126
activation ledger. This targeted map is not an exhaustive replacement for it.

## Proposed scope / excluded scope

Include: private current-state financial facts, deterministic identity sets,
economic position, customer tender movements and diagnostics against current
public projections. Reuse existing evidence validators; never insert anchors from
a read. Incomplete anchors produce explicit incomplete/unsupported evidence, not
apparently valid zero totals. Do not modify a closed writer to make a read pass.

Exclude: public RPCs/grants, public trigger changes, new payment creation,
reversal activation, Admin UI changes, full drawer accounting, profit-report
presentation, GL, and any Production rollout. Those require separate bounded
design/authorization. No number/name is assigned to later slices here.

If approved after independent design review, use one additive migration (next
number 127 only under explicit implementation authorization) for private
`SECURITY INVOKER`, postgres-owned, schema-qualified functions with fixed
`search_path`, and zero EXECUTE/schema grants for application roles. Prefer
derived reads over new duplicated financial tables or materialized projections.

Proposed interfaces, names provisional until design approval:

- `phase5_private.read_order_financial_facts_v1(uuid) -> jsonb`: typed source,
  validated reversal and settled operational Return identities and full tuples.
- `phase5_private.read_order_financial_position_v1(uuid) -> jsonb`: coverage,
  debt, refund, delivery and current refundable capacity from those facts.
- `phase5_private.reconcile_order_financial_position_v1(uuid) -> jsonb`:
  canonical/private values alongside current public values and named differences;
  never writes or silently repairs either side.

Initial supported domain: completed modern POS V2 / Customer V2 sales with
complete existing operational evidence. Legacy, non-completed/reversed lifecycle
states, unanchored payments or unbound old reversals must be explicitly unsupported
or incomplete, not coerced to the modern contract. A Legacy tag is not a bypass
for mixed modern/Legacy evidence within one sale.

## Facts and arithmetic contract

Membership must originate from the authoritative Order/creation/completion,
public payment population and committed event relations, not a caller-supplied
list or stored aggregate. Validate exact identity/tuple coverage bidirectionally,
including extra/orphan events. Keep source IDs and operation IDs with totals.

- POS initial receipt: immutable original operation result/request binding.
- Customer full initial receipt: authoritative completion evidence.
- Customer partial initial receipt: the exact linked customer payment once;
  its completion node contributes zero additional collection.
- Later payment: exact public payment and validated canonical anchor. Missing
  anchor is incomplete evidence; no implicit insert and no guessed amount.
- Payment reversal: full exact payment plus valid operational 503 completion and
  tender movement; foundation-only evidence is not operational settlement.
- Return: settled 401 contract with authoritative Phase 4.2 operational evidence;
  cancelled/draft/foundation-only rows must not contribute settled totals.

### S4-DG1 — complete discovery before classification or aggregation

Discover candidate ownership independently of whether a child or completion
exists. An operation whose request names this Order is a candidate even if it
has no child. A child/completion/movement that contradicts that identity cannot
disappear through an inner join, a settled-only filter or a result-type filter.
`orderId` in Phase 5 JSON and `order_id` in Phase 4 request JSON are different
repository field names; decode each exact typed contract, not one guessed key.

The discovery inventory through Migration 126 is:

| Node/relation | Independent seed / reverse edge | Required identity coverage |
| --- | --- | --- |
| Modern creation/completion `public.business_operations` and Order | `orders.operation_id`; Customer completion request `order_id`, result Order identity and authoritative completion time | Exact supported creation/completion binding; partial completion's linked payment is not another inflow. |
| `public.customer_payments` | All payment rows declaring the Order, without tender/reversed filters; source IDs referenced elsewhere | Every supported payment has exactly its validated collection anchor; old `is_reversed` history is explicit unsupported/conflicting evidence, not silently removed. |
| `phase5_private.financial_operation_events` | Request/result `orderId`; operation IDs referenced by any child, movement or completion | One collection child for a collection operation, or one reversal child plus one movement and one 503 completion for an operational reversal. A disconnected operation is incomplete, not zero money. |
| `phase5_private.collection_events` | Declared `order_id`, `original_payment_id`, `financial_operation_id` | Exact payment/Order/customer/actor/amount/tender/reference/source binding; no orphan or substituted child. |
| `phase5_private.payment_reversal_events` | Declared Order, original payment/collection and financial-operation links | Exactly one full reversal of its exact source payment, validated as operational; foundation-only reversal makes the read ineligible. |
| `phase5_private.reversal_tender_movements` | Declared Order, original payment, reversal event and operation links | Exactly one actual-tender movement for each operational reversal and no other operation-owned movement; all source/actor/amount/Shift/time tuples must match. |
| `phase5_private.reversal_coordinator_completions` | Operation link, result Order identity, `sources_snapshot`, prior-reversal IDs and settled-Return IDs | Exactly one 503 completion for each reversal; validate historical snapshot membership using the closed validator, never use its claimed list as the sole current discovery seed. |
| Return operation/header `public.business_operations` / `sales_return_events` | Phase-4 Return request `order_id`, result `orderId`, header Order/operation links | Explicit draft/cancelled/settled lifecycle classification; only a valid settled 401/402 operational Return contributes financial amounts. |
| `public.phase42_return_settlement_evidence` / `phase42_return_inventory_effects` | Declared Order where present, operation/header IDs, referenced inventory movements | Exact operation/header/result binding; both missing expected evidence and extra actual evidence reject. Zero-restock does not permit an unrelated extra effect. |
| Return items, component inspections, `sales_aftercare_consumptions` and `inventory_movements` | Operation/header/item/consumption links and `phase4_sales_return` movement reference identity | Resolve the complete actual operation-owned set before validating current physical lineage/quantity/cost; reuse final Migration 122 evidence validation, not the subset reachable from expected effects. |

Algorithm and failure contract:

1. Seed from the authoritative Order/creation/completion and all its payments,
   plus every typed request/result or declared Order column naming it in the
   inventory above. Do not first require a valid child/result to discover a row.
2. Expand to a fixed point over the declared identity edges in BOTH directions.
   Follow operation, event, payment, header, item and movement IDs and claimed
   completion membership, even when a claimed edge is invalid. These are
   discovery candidates, not automatically trusted financial facts.
3. For every discovered node, compare all declared/linked Order identities.
   If an event names A but its source belongs to B, the affected graph is
   inconsistent; do not choose one identity arbitrarily or exclude the row.
4. Derive expected identities from validated independent sale/payment/header
   anchors. Prove expected-to-actual and actual-to-expected tuple coverage with
   cardinality per authoritative identity. Counts/sums or SQL set deduplication
   alone cannot hide `{A,B} -> {A,A}`. Include every candidate operation-owned
   row, not just the child subset a validator happens to traverse.
5. Classify only after discovery. A valid nonterminal Return with no committed
   settlement, finalized consumption or financial effect contributes no settled
   money. Terminal-looking/foundation-only modern settlement, or finalized
   evidence under a nonterminal parent, rejects. Legitimate private collection
   anchoring describes an existing inflow once; incomplete private financial
   operations/reversals are not adopted or ignored. Preserve Legacy/nonmodern
   routing as explicitly unsupported, without fabricating modern facts.
6. Include a bounded unassignable-node integrity check over these Phase-5
   financial relations and Phase-4 Return nodes: a malformed node with no usable
   Order identity AND no resolvable link cannot be attributed to this Order.
   Report `UNASSIGNABLE_EVIDENCE` and fail closed for the private read; do not
   pretend per-Order discovery proves its absence. A valid unrelated Order's
   incomplete but assignable evidence does not contaminate this Order. This
   check is not a scan/classification of all unrelated application operations.

`reversal_coordinator_guards` contains transient transaction authority, not
money. Never count it as collection/reversal/completion evidence or wait on it.
If a read observes its own transaction's unfinished relevant writes, classify
the incomplete graph accordingly; the read does not finish it. Do not reject
unrelated valid graphs merely because an unrelated transaction owns a guard.

All three proposed interfaces share this discovery/classification boundary.
Use named exceptions for invalid input, unsupported domain, incomplete evidence,
inconsistent evidence and unassignable evidence. Do not catch validator errors
and return `VALID`, zero totals or a partial aggregate. Reconciliation may
diagnose a stale public projection only AFTER canonical facts are valid; an
invalid canonical graph has no trustworthy numeric position to reconcile.

Source proof: Migration 123 does not require a financial-operation child;
Migration 126 `discover_collection_population_v1` alone is not this total
discovery algorithm, and operation validators alone cannot find an unsupplied
orphan. The new read boundary must add discovery; no closed writer/validator is
changed or claimed complete for this expanded responsibility.

For a complete supported population, using integer money minor units:

```text
C = committed original collections (each economic receipt once)
V = valid committed operational payment reversals
D = settled Return debt reductions
R = settled Return monetary refunds
T = authoritative original order total
L = non-refundable delivery service amount

collection_coverage = C - V
settled_merchandise_return_entitlement = D + R
outstanding_total = max(T - collection_coverage - D, 0)
delivery_outstanding = min(L, outstanding_total)
collected_delivery = L - delivery_outstanding
merchandise_debt = max(outstanding_total - delivery_outstanding, 0)
refundable_collected = max(collection_coverage - R - collected_delivery, 0)
customer_net_money_flow = C - V - R
```

Validate impossible negative/over-allocated inputs before applying contract
`max`/`min`; clamping must not hide evidence corruption. Refund does not reduce
`collection_coverage`, recreate customer debt or get subtracted twice. Total
settled entitlement is after approved damage deductions, excluding delivery.
This is not a new commercial policy or partial-payment reversal feature.

### S4-DG2 — validity domain before derivation

Use exact integer minor units (wide exact accumulation, checked BIGINT result
range), never floating point or lossy casts. Required SQL fields, JSON types and
identity fields must be present/non-null, finite and correctly typed before
comparison. SQL `UNKNOWN`, JSON `null`, missing keys and malformed numeric text
are failures, not optional amounts. `T` and `L` come from validated immutable
modern sale/completion evidence and its frozen Order binding, not mutable public
paid projections or current price. Require `0 <= L <= T` and nonnegative
validated source/event amounts.

For each full reversal, require its exact original payment and amount,
one operational completion/movement, no repeated reversal of that source,
and the closed historical candidate-capacity validation. Aggregate
`0 <= V <= C` is necessary but not sufficient for source-level reversibility.
Full initial collection without a payment row does not become a reversible
payment merely because it is included in `C`.

For each settled Return `i`, derive historical merchandise entitlement `E_i`
from immutable authorized items/Parcel identity and approved damage deductions,
and prove its operation/header/evidence/result relations. Then require:

```text
E_i >= 0; D_i >= 0; R_i >= 0
E_i = D_i + R_i
D_i = min(E_i, B_i)
R_i = E_i - D_i
R_i <= N_i
```

`B_i` is the stored merchandise-debt-before snapshot;
`N_i` is the stored refundable-collected-before snapshot. Despite their generic
column names, Migration 121 writes `merchandise_debt_in_minor_units` to
`outstanding_debt_before_snapshot_in_minor_units` and
`refundable_collected_in_minor_units` to
`net_collected_before_snapshot_in_minor_units` (lines 1518–1535).
Do not subtract delivery/refunds from these snapshots a second time. Validate
nonnegative snapshots and their immutable settlement/result binding; do not
recreate a historical debt-first allocation using today's collection/debt.
This read adds no guessed historical transaction-order reconstruction.

Zero monetary refund requires null refund method/reference and no refund Shift
effect. Positive monetary refund requires the existing valid Cash/CliQ method,
recorded Shift context, and CliQ reference as required by the Phase 4 contract.
Do not apply Slice-3 CliQ-reversal Shift rules to historical Return evidence.
Do not infer Return tender from original payment tender. The reader checks
historical execution evidence, never requires an already-closed refund Shift
to still be open today.

Once the complete per-identity graph and historical events are valid, require
these current-state predicates BEFORE returning any clamped derived values:

```text
X = C - V
X >= 0
D = sum(D_i); R = sum(R_i); D + R <= T - L
X + D <= T
O = T - X - D                 # nonnegative by the previous predicate
DO = min(L, O)
CD = L - DO
R <= X - CD                  # nonnegative money backing, excluding delivery
```

The historical item/Parcel consumption capacity checks remain independently
required; aggregate `D+R <= T-L` cannot replace them. `O`, `DO` and `CD` here
are checked intermediate quantities, not a clamp accepting corruption. Their
validated values feed the earlier position equations. Consequently refundable
capacity is nonnegative, and actual Cash + CliQ net flow must equal `X-R` for
the same exactly covered movement population. Negative Cash net flow is valid
in a cross-tender refund; negative event amounts or economic capacity are not.

Do NOT require gross `C <= T`: collections 130 and valid full reversals 30 for
total 100 yield valid coverage 100. Do NOT subtract `R` from `X`, add it back to
debt, or subtract it twice from refundable capacity. Current integrity failure
after a purported reversal is corruption/ineligibility, not a new permission
for partial reversal or a reader-owned business repair.

Delivery non-refundability governs merchandise Return entitlement; it does not
invent a stricter payment-reversal rule than the closed candidate validator.
For `T=110,L=10,C=110,D=0,R=100`, a valid full reversal of an exact payment 10
would give `X=100`, delivery debt 10 and net money 0 under the existing formula;
a full reversal of exact payment 20 would give `X=90 < R` and reject. These are
conditional design traces: exact source identities and the closed historical
reversal validator are still mandatory. Refund alone must never recreate debt;
do not confuse it with the separately committed payment-reversal effect.

Source-grounded traces: `C=100,R=110,T=100,L=D=V=0` rejects for refund backing;
`C=100,D=30,T=100,V=R=L=0` rejects for over-allocation;
`C=130,V=30,T=100,D=R=L=0` remains valid, subject to exact source validation.
These are design arithmetic examples, not committed PostgreSQL test results.

Separately, for the same validated customer movement population:

```text
customer_cash_net_flow = Cash collections - actual Cash reversals - Cash refunds
customer_cliq_net_flow = CliQ collections - actual CliQ reversals - CliQ refunds
```

These are customer flows, NOT complete expected drawer cash (opening balances,
supplier payments and expenses are outside this slice). Attribute each inflow
to original source time/Shift and each outflow to actual committed time/tender/
Shift. Anchor time is audit metadata, never a second inflow. Never infer refund
tender from original collection tender, and never rewrite a closed Shift.

Example: CliQ collection 100, Cash refund 30, no debt/reversal/delivery gives
coverage 100, monetary net flow 70, Cash flow -30, CliQ flow +100, debt 0.
Future Cash mutation still requires its valid current open Shift; this read
layer cannot grant that permission or fabricate a Cash movement for CliQ.

Preserve original-sale COGS, replacement operational cost and sellable-return
restock recovery as separate immutable dimensions in later reporting. No profit
formula or current WAC/price fallback is introduced here. A financial-position
read is not itself a sales-gross-margin or aftercare-adjusted-margin report.

## Read consistency, replay and locks

Use one consistent PostgreSQL snapshot for facts and derived values. A multi-call
test comparison must use one read-only repeatable-read transaction; separate
READ COMMITTED calls are not proof of one coherent snapshot. Do not offer an
arbitrary `as_of` historical API without an independently specified visibility
and timestamp contract. Snapshot time and event cutoff are not synonyms.

### S4-DG3 — explicit calling-query snapshot and read-only call graph

All three proposed interfaces, and any new table-dependent discovery/derivation
helpers, must be SQL/PLpgSQL `STABLE`, not default `VOLATILE` and not `IMMUTABLE`.
Their SELECTs use the calling query's MVCC snapshot. Volatility declarations
alone are insufficient: a STABLE function can still call a side-effecting
VOLATILE helper, so validate the transitive exact-signature call graph.
Reference: [PostgreSQL function volatility](https://www.postgresql.org/docs/current/xfunc-volatility.html).

The proposed dependency graph is:

```text
reconcile_order_financial_position_v1
  -> read_order_financial_position_v1
       -> read_order_financial_facts_v1
            -> new STABLE total graph discovery/classification
            -> closed STABLE source/collection/reversal/Return validators
       -> new STABLE pre-derivation validity + exact arithmetic
  -> public projection SELECTs (diagnostic only, same calling query snapshot)
```

Existing eligible validator roots are Migration 126 `collection_source_v1`,
`discover_collection_population_v1`, `validate_operational_reversal_v1`
(including its historical `reversal_position_v1` check), Migration 124
collection/reversal validators, and the final Migration 122
`phase42_assert_operational_return_evidence_internal` wrapper and its physical
evidence validation. Their declarations are STABLE; implementation must verify
every transitive called overload against the rebuilt catalog and source before
admitting it to this read graph. Declaration checks are not runtime proof.
If an otherwise useful old helper is default VOLATILE, use an additive strictly
read-only STABLE helper in the authorized new migration instead of relabeling a
frozen historical function or relying on a default wrapper's internal snapshots.
Any resulting contract contradiction stops for owner review.

Explicitly excluded: collection anchoring/writers, reversal coordinators,
operational Return/Replacement settlement/finalizers, locking helpers,
`FOR UPDATE`/`FOR SHARE`, advisory locks, sequence calls, dynamic mutation,
external/network calls, transaction isolation changes, and the old
`phase42_order_financial_position_internal` as canonical money authority.
Only pure IMMUTABLE scalar decoding/arithmetic is admissible underneath a
STABLE table read. Fixed search paths and schema-qualified calls remain required.

Do not provide `clock_timestamp()` as an evidence cutoff or describe
`transaction_timestamp()`/`statement_timestamp()` as the time of every visible
commit. Prefer no wall-clock visibility claim; if metadata includes statement
start time, label it precisely. Event timestamps retained in facts are their
immutable repository event timestamps, not bank or commit timestamps.

A standalone READ COMMITTED calling SELECT returns one coherent snapshot;
the next SELECT can see a later committed mutation. Multi-call equivalence
checks use `REPEATABLE READ READ ONLY`. Do not consume this read from a
data-modifying CTE/coordinator and assume it sees that same statement's new
writes. This Slice supplies no capacity reservation or post-write settlement
validator; future mutation consumers need separately specified post-lock logic.

Future implementation proof must pause a read between discovery and derivation
with an isolated test-only harness (not a production helper/lock), commit a
valid concurrent collection/reversal/Return, then release the read. The first
result must match one complete pre-commit graph/position and the next standalone
call the complete later graph/position. Verify the reconciliation diagnostics
use that same snapshot; perform repeated comparison inside read-only repeatable
read; verify no read-owned write or business/advisory gate. Measure runtime
behavior then, not in this source-only design closure.

These private reads must not acquire mutation gates, create anchors, change
evidence or call coordinators. Existing coordinator replay remains historical
and read-only; current position may change after later activity while that replay
result stays identical. Do not route replay through the new current reader.
Future mutation consumers must revalidate inside their own post-lock transaction;
an earlier read result reserves no capacity.

The existing Slice 3 mutation order remains auth -> scoped idempotency -> root
`phase4-order|<order-id>` -> planned Shift(s) -> Order -> payments -> collections
-> FK parents -> fresh plan/authorization check -> evidence. No new lock namespace
or reverse-order acquisition is authorized by this proposal.

## Future activation boundary — explicit remaining work, not this slice

Before any new authoritative/public path becomes active, converge the complete
writer/reader/guard/trigger/grant family, not just the new coordinator:

1. Complete exact-signature through-current-migration inventory and caller map,
   including initial modern collections, once and non-once payments, legacy and
   internal wrappers, full-Shift and sale reversals, scheduled/dynamic callers.
2. Specify atomic new payment + canonical evidence creation (existing-source
   anchoring is not a new collection API), public authenticated actor derivation,
   replay compatibility and strict Legacy routing.
3. Replace paid projection and trigger behavior together with Phase 4 financial
   readers/guards. Prevent old writer or direct authority from restoring obsolete
   paid values or bypassing candidate-state capacity checks.
4. Converge actual-tender Shift summaries, close snapshots, dependency guards and
   downstream report readers without losing original receipts or double counting.
5. Prove the activation DDL/ACL transition is atomic with the chosen migration
   mechanism, exact owner/search_path/ACL assertions and injected failure. Migration
   126 contains explicit BEGIN/COMMIT; that alone does not prove a future external
   caller rollout or Production transition is transactional.

Private inactive coexistence is permitted until then. No current public reader
may trust incomplete private evidence. No old bypass writer may survive the
future activation boundary. Live owner/ACL/external jobs remain unverified here;
Production verification requires separate authorization. Existing activation
implementation obligations remain OPEN, not defects retroactively closed by
Slice 3 CI or by this design.

## Pre-implementation break matrix (future runtime obligations)

| Challenge | Expected private-read / reconciliation proof |
| --- | --- |
| Payments A=70, B=30; full reversal B; legacy trigger fires | Canonical coverage 70, stale public projection 100 is an explicit difference; no partial reversal or public repair. |
| Paid sale with valid no-payment-row initial collection | Correct typed initial source, never inferred from current `amount_paid`. |
| Customer partial completion linked to a payment | Exactly one economic inflow; root+payment duplication rejected. |
| Missing anchor / orphan or duplicate event / coherent substituted source | Incomplete/corrupt state rejected, never a smaller apparently valid total. |
| Foundation reversal without operational 503 evidence | Not counted as valid operational reversal; fail closed. |
| CliQ receipt, Cash refund/reversal on later Shift | Independent tender/time attribution; old closed Shift unchanged. |
| Return debt-only / refund-only / mixed, delivery, damage cap | Equations match approved settlement; refund neither creates debt nor subtracts twice. |
| Replay after later payment/Return/reversal | Old stored replay unchanged; current reader sees only its coherent current snapshot. |
| Same-count source/prior/Return substitution and extra rows | Per-identity exact coverage and corruption rejection, not SUM/count proof. |
| Concurrent collection/reversal/Return while reading | One coherent snapshot, no mixed aggregate state; zero read-owned writes/locks. |
| Actual Legacy / modern mixed history / old unbound reversal | Explicit unsupported/incomplete state, no guessed historic facts. |
| anon/authenticated/service_role direct helper calls | Denied; no new public or scheduled caller. |

Use real isolated modern fixtures and the existing private coordinator. Do not
simulate operational success only by inserting evidence rows. Corruption tests
are privileged, disposable and rollback-controlled. Verify full content-sensitive
before/after fingerprints for reads and unchanged existing public responses.

### Targeted closure matrix — additional mandatory implementation evidence

| Closure | Adversarial cases | Required future proof |
| --- | --- | --- |
| DG1 reverse discovery | Request-only orphan operation; completion with no valid child; movement declaring another Order; orphan Return effect/movement; malformed unassignable financial operation | Incomplete/inconsistent/unassignable failure, no silently smaller total and zero content mutation. |
| DG1 exact ownership | Same-count `{A,B}->{A,A}`; wrong payment/operation/Order links; missing expected and extra actual child; foundation-only reversal; own unfinished evidence | Per-authoritative-identity coverage in both directions, no successful numeric position. Valid unrelated assignable graph does not affect this Order. |
| DG2 admissible arithmetic | Valid gross recollection 130/30/100; delivery-only residual; debt-only/mixed/refund-only Return; cross-tender negative Cash flow | Exact expected numbers from independent fixture facts; no gross-collection cap, guessed tender or recreated debt. |
| DG2 invalid arithmetic | Negative/null/JSON-null/overflow amount; refund110 against coverage100; coverage100+debtReduction30 against total100; delivery money improperly refundable | Reject before derived clamp; no zero-looking success. |
| DG2 historical allocation | Valid debt-first historical snapshots after later payments; swapped snapshot meanings; coherent equal-total item substitution | Historical snapshot/item/result validation, not recalculation from current debt; exact capacity identity still enforced. |
| DG3 visibility | Reader paused between discovery/derivation; concurrent valid commit; reconciliation and repeated read-only repeatable-read comparison | One calling-query snapshot; next READ COMMITTED call fresh; no mixed facts or diagnostics. |
| DG3 authority | Missing STABLE declaration; transitive volatile/mutating helper; hidden advisory/FK/write/sequence path; unauthorized app role invocation | Catalog plus exact source call graph fail closed; runtime zero-write/no business gates and denied unsupported callers. |

These rows are an implementation break matrix, NOT permanent tests already
added or executed. The current closure uses source-grounded graph traces and
exact BigInt arithmetic checks only. There are zero remaining definitions for
the three scoped design gaps; independent confirmation is still required.

## Proposed gates and next decision

First owner review of this scope, then bounded independent design challenge of
membership, snapshot consistency, semantic equations and non-activation. Resolve
its findings before separate implementation authorization. No new business policy
decision has been identified in this targeted proposal; this is not a claim that
all future activation design questions are already closed.

After authorized implementation: focused static/null/identity/ACL tests -> fresh
isolated rebuild through the approved new ceiling -> real private read/runtime
matrix and affected Slice 2/3 + Phase 4 financial regressions -> independent
re-sign-off. Full Canonical/quality belong to that candidate's approved final gate,
not this documentation-only preparation.

No runtime PASS, measured deadlock safety, activation completeness or release
readiness is claimed by this source review. Public activation design remains
incomplete and prohibited. Proposed Slice 4 scope is READY FOR OWNER REVIEW;
Slice 4 IMPLEMENTATION is NOT AUTHORIZED / NOT STARTED.
