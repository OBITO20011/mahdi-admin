# Slice 3 private coordinator candidate

Status: bounded historical-membership correction implemented; corrective
verification and independent re-review required. Not owner-closed or activated.
Owner authorization baseline: `6fac32ac422206a3b5e5716159304806f30d0aed`.
Additive migration: `126_phase5_private_tender_coordinator.sql`.
The current candidate fingerprint is pinned in `project-state.json`; migrations
001–125 remain historical and unchanged.

## Authority and coexistence

All eleven new functions are private `SECURITY INVOKER`, owned by `postgres`,
with `search_path = pg_catalog`. Application roles have no schema, function or
table mutation authority. New evidence tables force RLS without app policies.
The owner/admin/manager/accountant reversal actor check is before idempotency locks
and before replay. Existing-source anchoring also preserves the closed collection
contract's Sales capability, but only for that exact payment's original actor;
source ownership is checked before locks. This actor parameter is private trusted input, NOT a new public
authentication contract. Future public wrappers must derive it from auth.

No public payment writer, paid projection, aftercare guard, Shift summary,
closing snapshot, reporting view or application caller is replaced here.
The original public payment stays unchanged. This slice cannot be activated
until the separately reviewed transaction converges all those dependencies.
The pre-existing activation implementation defect families remain OPEN.

## Shared boundaries

| Boundary | Implementation |
| --- | --- |
| Original source anchoring | `anchor_existing_collection_v1`, over one real source payment; does not create another payment/inflow |
| Typed source truth | `collection_source_v1` and `discover_collection_population_v1` |
| Frozen pre-write lock plan | `coordinator_lock_plan_v1` and `lock_coordinator_context_v1` |
| Economic candidate position | `reversal_position_v1`, complete source population minus validated prior operational reversals |
| Full exact-payment reversal | `coordinate_payment_reversal_v1`; no partial amount parameter |
| Finalization and replay | `validate_operational_reversal_v1`, also used by deferred completion triggers |

Root lock domain remains `phase4-order|<order-id>`, after the exact Slice-2
actor/type/key idempotency domain. All relevant Shift identities are acquired
in UUID order before Order/payment/collection and FK-parent locks. Current
Cash Shift uses UPDATE; historical anchoring FK Shift uses KEY SHARE; a shared
identity uses UPDATE first. Planned row locks use NOWAIT; contention and changed
discovery reject with `40001`, not a late lock acquisition or hidden timeout.
The old rediscovering lock helper is never called by these new entrypoints.

## Durable operational distinction

An immutable Slice-2 reversal result alone is NOT coordinator completion.
Fresh coordination inserts the foundation operation/reversal, actual-tender
movement and separate coordinator completion in one transaction. An internal
transaction guard protects completion insertion. Exactly one movement is
bound to each operation, exact payment and reversal identity by unique keys;
the shared validator compares the complete tuple and exact stored result.
Missing or contradictory completion/movement cannot finalize or replay.
Foundation-only events cannot be adopted or backfilled as operational success.

Original source time (`customer_payments.created_at`), later collection-anchor
recording time, and post-validation reversal event time stay separate.
All new reversal records share the same captured event time. Original tender
and actual reversal tender are independent. Cash requires the current open
Shift; CliQ requires a reference and has no Cash Shift. Replay revalidates
durable historical facts, not today's open Shift/eligibility or new capacity.

## Financial source completeness

POS initial collection is anchored in the immutable POS operation, not a
fabricated payment or `orders.amount_paid_in_minor_units`. Customer full initial
collection has its completion source. Partial Customer completion contributes
zero as a completion source and its exact linked real payment contributes once.
Every real per-Order payment needs a matching validated Slice-2 anchor.
Unsupported Legacy, missing sources, contradictory completion/payment linkage
and prior foundation-only reversals fail closed.

Candidate position preserves debt-first allocation and non-refundable delivery:
`candidate = collections - validated_prior_reversals - exact_payment_amount`.
Collected delivery is derived from candidate outstanding debt after settled
debt reductions. Candidate coverage must be nonnegative and cover monetary
refunds plus collected delivery. Refunds are capacity constraints, not a second
subtraction recreating debt. Modern settled Returns are validated through the
existing central Phase-4.2 evidence validator before using their split.

## Verification and remaining gate

Static/continuity suite: `tests/phase5-private-coordinator.test.ts` and affected
continuity/Slice-2 tests. Runtime entrypoint:
`npm run test:phase5-slice3:runtime`.

The focused runner uses a disposable full-schema 001–126 rebuild and actual
modern POS/Customer creation, completion and payment RPCs. Private coordinator
calls remain privileged isolated tests. It probes operational replay, cross
tender, foundation-only rejection, initial/replay evidence corruption,
after-each-write rollback, ACL, closed-Shift replay and observed two-session
idempotency races. Durable fingerprints include full row content, not counts.

The continuation checkpoints below record completion of the focused matrix,
affected runtime, quality and corrected uninterrupted Canonical. Candidate
sign-off still requires independent read-only review. Earlier gate cancellations
are retained below with the bounded correction and final result; these
implementation tests do not constitute independent closure certification.

Focused checkpoint (2026-10-01): candidate canonical SHA-256
`9047E102E4A112FBC8EDB80C69FB04E6AF9A1B04CF22238BDFF47C05F4F88E21`.
Fresh isolated 001–126 runtime passed 14 axes, including real Customer V2 sources,
Sales-owned collection anchoring, financial-role reversal, pre-write historical
Shift contention and same-key/changed-payload two-session races with sampled
`deadlockDelta=0`. Static/continuity 33/33, full unit suite 653/653, TypeScript,
strict ESLint and fresh DB lint passed. Remaining Shift-plan/full-Shift and
post-Return probes, affected runtimes, Canonical/quality and independent review
are still required. The newly added migration-history-count assertion in the
runner will execute on the next fresh runtime; development stack adoption is
explicitly not a fresh-rebuild gate and is forbidden under `CI=1`.

Continuation checkpoint (2026-10-01): the migration-history assertion now passed
on a fresh rebuild (126 entries, 001 through 126). The expanded runner passed
17 axes. Added real independent-session profile/customer/payment/Order FK-parent
contention with zero durable footprint and successful retry after release;
actual `close_cash_shift` versus coordinator in both scheduling directions with
observed blocking and rollback; and actual Phase-4 Return settlement on partial
and fully paid sales followed by rejected reversal of the refund backing.
Focused tests 26/26, TypeScript, strict ESLint, DB lint, changed-runner Gitleaks
and diff integrity passed. Migration 126 bytes are unchanged.

Still pending: inverse UUID/strongest same-Shift probes, changed discovery,
actual full-Shift reversal interaction, delivery-specific candidate cases,
affected prior runtimes and final gates. The measured zero deadlock delta belongs
to the instrumented idempotency races, not a claim covering all remaining cases.

Focused completeness continuation (2026-10-01): fresh isolated 001–126 runner
passed 21 axes on the unchanged migration fingerprint. It now verifies the
strongest UPDATE lock for a shared current/historical Shift, inverse UUID
current/historical modes, and actual full-Shift reversal RPC contention in both
directions with observed database blocking and deadlock delta zero. Existing
full-Shift business-dependency rejection remains valid; no public activation
or full-Shift policy change is claimed. A disposable planner instrument changes
a payment source between discovery and revalidation and proves `40001` plus
complete rollback. This instrumented check is distinct from a concurrent public
source writer race.

The real Customer V2 delivery fixture uses 300 delivery and 1000 merchandise.
Return refunds merchandise only; reversing its 1000 refund backing rejects,
while full reversal of the separate 300 payment yields candidate coverage 1000
and zero collected delivery. Its committed replay is zero-write. The helper's
initial zero delivery argument at completion caused a fixture rejection and was
corrected to pass the actual delivery amount. No migration/business code changed.

Durable fingerprints now include inventory balances/movements, Return headers,
Shift reversal evidence and audit rows as well as financial operations/payment
state. Focused 26/26, TypeScript, strict ESLint and changed/untracked Gitleaks
(14 files) passed. Prior-slice regression and final Canonical/quality are pending;
independent sign-off remains required.

Final focused matrix: 23 axes PASS, including two different keys against one
exact payment in both scheduling directions (one movement and zero loser
operation), and cross-sale contention on the same current Cash Shift followed
by a valid retry bound to its own sale/payment. The unchanged Slice-2 runtime
also passed with six observed idempotency races and deadlock delta zero. Final
Canonical and quality gates are now the pending implementation verification.

Final gate checkpoint (2026-10-01): `npm run quality -- -- --retries=0` under
`CI=1` passed. Admin unit tests were 653/653; Admin/Customer lint and builds,
isolated Customer SEO, network-isolation verification, and complete Browser QA
passed. Browser QA reported 207 passed and 51 intentional conditional skips.
The separate Chromium/WebKit isolation proof recorded zero escaped external
or Production requests, and the full Browser QA teardown audit passed. The
conditional full-stack skips are not counted as fresh full-stack DB proof.
Strict ESLint also passed.

The single uninterrupted Canonical run did NOT pass. Nine tests passed,
including Phase 2 receiving/WAC, Phase 3 contracts, Phase 4 foundation and
Phase 4.2 atomic Return races. At 1800004ms the unchanged 1800000ms parent
deadline cancelled the final Gateway group and its parent: 9/11 passed,
2 cancelled, exit code 1. Gateway had run approximately 143189ms when cancelled;
its own 600000ms command deadline had not expired. No SQL/business error was
reported for that cancellation. A standalone Gateway diagnosis does not replace
the required uninterrupted gate. No assertions, coverage, retries, or timeout
were weakened to turn this result green. Migration 126 remains unchanged and
the candidate remains IN PROGRESS with this material evidence gap.

Smallest affected diagnosis: the unchanged Gateway runner passed independently
on a fresh isolated stack, including Base Unit and Parcel lost-response replay,
cross-version identity/privacy, and 50-request rate-limit reconciliation. This
does not convert Canonical to PASS. The full Canonical and quality gates had
been running concurrently with separate DB/HTTP resources; shared host resource
contention is a hypothesis, not a proven root cause. The parent-deadline
cancellation is confirmed; the cause of overall duration remains unresolved.
No additional full Canonical run was used to mask the cancellation. Continuity
now names the Canonical gap and subsequent independent review explicitly, and
the affected static/continuity tests passed 26/26 after that factual update.

Bounded Canonical diagnosis continuation (2026-10-01): one unchanged Canonical
run alone, with no quality/browser suite in parallel, again reached its original
1800000ms parent deadline. Nine tests passed; Gateway and parent were cancelled
(Gateway had only 112869ms). Phase 3 passed in 521782ms versus 460830ms in the
prior concurrent run. Removing browser concurrency alone therefore did not
resolve the gate; host contention is not established as its sole cause.

A paired disposable full-schema bootstrap comparison used the existing profile
and a SQL-only profile excluding gotrue, Kong and PostgREST. Measured bootstrap
times were 95546ms and 80197ms. Both had empty auth baselines and fresh volumes.
Normalized schema-only dumps including ownership, ACLs, functions, triggers,
tables and policies for auth/public/phase5_private matched exactly at SHA-256
`134dc8e824c93e8c3ca6d391c7376d12afc9b72608567130d138a999cdbd4bfe`.
This identifies avoidable HTTP-service lifecycle overhead in SQL-only groups;
it does not claim to explain all host timing variation.

The bounded harness correction adds only those three HTTP-service exclusions
to the Canonical SQL profile and the two Phase-4 runners that override it.
These runners use psql/Docker DB calls rather than HTTP clients. Gateway keeps
its explicit HTTP-enabled profile, including gotrue, Kong, PostgREST and Edge
Runtime. An automated HEAD comparison proved that after removing comments and
the exact added service names, all three files remain identical to HEAD;
assertions, coverage and timeouts are unchanged. Focused 26/26, TypeScript and
strict ESLint passed. One full corrected Canonical run is in progress; no PASS
is claimed before its terminal result.

Corrected final gate result: uninterrupted Canonical PASS 11/11, exit 0,
zero failed/cancelled/skipped. Parent duration 1783416.9109ms under the unchanged
1800000ms deadline (overall runner 1783993.5828ms). Recorded subgroup timings:
supplier 175732ms; orders 713ms; flavor/receiving 893ms; canonical inventory
10545ms; Parcel foundation 156079ms; Phase 2 receiving 328241ms; Phase 3
517767ms; Phase 4 foundation 150745ms; Atomic Return 177382ms; real HTTP Gateway
163749ms. Gateway containers included Auth, REST, Kong and Edge Runtime.
No retry, timeout increase, coverage reduction, or assertion change produced
this PASS. Approximately 16.6 seconds remained in the parent budget; that is a
narrow timing margin, not evidence of universal runtime stability. The current
uninterrupted verification gap is closed. Independent Slice-3 review remains
required and must include the bounded three-file harness profile correction.
Previously passing quality/browser evidence is retained because no application
or browser path changed; affected continuity checks are rerun after this update.

## Historical membership corrective pass

The independent review reproduced a Medium counterexample through the actual
private coordinator on a fresh full schema: payments 700 and 300, both reversed,
then omission of the first reversal from the second completion's snapshot with
a coherent financial-position/result forgery. Replay returned success and 700
candidate coverage instead of the authoritative zero. Application roles were
denied; privileged corruption was rollback-only. No public bypass was proved.

The shared `reversal_position_v1` now derives the modern root from the original
Order operation/completion, payment source membership from independent immutable
collection anchors recorded at/before the operation cutoff, prior reversals
strictly before that cutoff, and settled Returns from their settlement time.
It compares exact identity sets and rejects duplicate/null identities before
performing financial arithmetic. Each member still receives full tuple and
operational-evidence validation. Collection anchoring time defines entry into
this private evidence population, not another inflow. Future anchors/reversals/
Returns do not alter earlier replay. Equal-time unrelated reversals fail closed
because their strict historical order is not proven. The coordinator captures
one cutoff after locks and uses it for position validation and persisted evidence.

Permanent break matrix: omitted prior with coherent position/result forgery;
duplicate/substituted prior; missing/duplicate/extra source; omitted/duplicate/
substituted settled Return; source/prior/Return omission during finalization;
clean chained replay after later anchors, reversals and a later Return. Every
rejection checks complete content fingerprints. The temporal members originate
outside the completion snapshot being challenged. This does not certify recovery
from arbitrary privileged deletion of all independent anchors.

The first corrective runtime attempt stopped at an overpayment fixture while
preparing a later-payment scenario; no PASS was claimed. The fixture now leaves
legitimate outstanding capacity, and the later-Return case uses a real partial
payment. Migration/business rules were not loosened. Focused static/continuity
27/27, TypeScript and strict ESLint passed. Corrected fresh 001–126 runtime now
passes 25 axes, including all historical-membership probes, actual modern
POS/Customer fixtures, previously covered corruptions, finalization/replay parity,
content-sensitive rollback, ACL and sampled real-session deadlock delta zero.
Strict fresh DB lint passed with only the existing allowed compatibility warning.
Corrected uninterrupted Canonical passed 11/11 with zero failures, cancellations
or skips. Parent duration was 1746308.2746ms under the unchanged 1800000ms budget;
runner total was 1746648.4291ms. The real Gateway passed in 148795ms. Roughly 53.7
seconds of budget remained; this measured result is not a universal timing claim.
Full quality for this correction passed once with CI=1 and retries=0: Admin unit
suite, Customer 189/189, lint/build/isolated SEO and Browser QA (207 passed,
51 intentional conditional skips). The fresh browser isolation verification
reported zero external/Production requests escaped for Chromium and WebKit;
four denied canaries and four denied unexpected attempts were verified.
Conditional skips are not additional full-stack runtime proof.
The subsequent bounded independent read-only re-review passed using fresh full
schema 001–126 and actual private RPC calls. Additional nested-prior corruption,
future-prior injection, wrong-root, SQL/JSON NULL and identity substitution probes
rejected with full rollback. Reordered valid identity sets and later-history clean
replay succeeded without writes. Nine application-role access attempts were
denied; strict fresh DB lint passed. Audit file fingerprints matched before and
after, with only the subsequent required continuity checkpoint updated.
The owner then closed Slice 3. Its local baseline awaits explicit commit/push
authorization and exact-SHA CI; Slice 4 remains NOT STARTED.
Current candidate hash
`4C099804BA1D6B97DF6AF3FA0C0A8D514FD616397BDE1BC7F5E5DAE3EB8B1D21`
is pinned in project-state, not inferred
from arbitrary runtime bytes. Migrations 001–125 and public authority stay frozen.
