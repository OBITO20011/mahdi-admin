# Phase 5 Slice 2 implementation map

Status: approved implementation map realized by Migration 124, independently
re-signed and OWNER-CLOSED; writers remain private and inactive.

Slice 2 adds private canonical collection and exact-payment-reversal writers over
the closed Migration 123 foundation. The writers are implementation-complete
evidence primitives, but they remain unreachable from current application roles
and callers. They do not replace current payment, Shift, Return, reporting, or
projection authority in this slice.

## Dependency and activation decision

- Gross reversal capacity is source-provable without implementing Slice 3. It is
  derived under the Order lock from canonical private collections/reversals,
  centrally revalidated settled versioned Return money-refund/debt-reduction
  facts, and the immutable Order total/delivery fee. A foundation-only modern
  settled-looking Return is rejected; a settled legacy Return with positive
  merchandise value but no split refund evidence is fail-closed rather than
  guessed.
- A Cash reversal requires and locks the current open Shift, and records that
  exact Shift in reversal evidence. Slice 2 does not yet own the compensating
  cash-drawer movement. Therefore both writers remain private and non-activatable
  until a later approved coordinator atomically owns the Shift/cash side effect.
- CliQ reversal records the actual CliQ reference and never creates or claims a
  Cash movement.
- Existing payment writers, legacy reversal writers, projection triggers,
  reports, and callers remain unchanged. Coexistence safety in Slice 2 is
  established by zero executable grants and zero caller edges, not by claiming
  that old and new writers are already one active authority.

## Writer/function map

| Writer / function | Exact signature | Transaction purpose | Reads | Writes | Lock order | Request/replay | Tender semantics | Security/current callers | Required proof |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `phase5_private.validate_customer_collection_operation_v1` | `(uuid) -> jsonb` | Reconstruct and validate the exact durable collection result | operation, collection, original payment | none | caller already owns operation context; read-only on replay | returns only the exact stored result after relational validation | exact Cash/CliQ source evidence | `SECURITY INVOKER`, postgres owner, no grants, no callers | corruption rejection and clean replay |
| `phase5_private.validate_customer_payment_reversal_operation_v1` | `(uuid) -> jsonb` | Reconstruct and validate the exact durable reversal result and its original collection | operation, reversal, collection, original payment | none | caller already owns operation context; read-only on replay | returns only the exact stored result after relational validation | actual reversal tender is independent of original tender | `SECURITY INVOKER`, postgres owner, no grants, no callers | corruption rejection and clean replay |
| `phase5_private.commit_customer_collection_v1` | `(uuid, uuid, uuid, bigint, text, text, text) -> jsonb` | Commit canonical evidence for one exact already-authoritative customer payment | profile/roles, Order, Shift, payment, operation/evidence | operation + collection evidence | idempotency gate -> Phase-4 Order gate -> open Shift -> Order -> payment -> evidence | actor/type/key scope; canonical JSONB fingerprint; exact result replay | Cash/CliQ only; amount/reference/Shift must exactly match source payment | `SECURITY INVOKER`, postgres owner, no grants, zero current callers | exact replay, changed-payload conflict, concurrency, unsupported tender rejection |
| `phase5_private.commit_customer_payment_reversal_v1` | `(uuid, uuid, uuid, uuid, text, text, text, text) -> jsonb` | Commit one full reversal event for one exact canonical collection | profile/roles, Order, current Shift, payment, collection/reversals, settled Returns | operation + reversal evidence | idempotency gate -> Phase-4 Order gate -> current open Shift when present/required -> Order -> payment -> collection -> evidence | actor/type/key scope; canonical JSONB fingerprint; exact result replay | full exact amount; Cash requires current open Shift; CliQ requires reference and records no Cash Shift | `SECURITY INVOKER`, postgres owner, no grants, zero current callers; non-activatable until cash movement coordinator | gross-capacity guard, duplicate/partial/cross-payment rejection, replay and concurrency |

## Canonical request identity

The writers accept scalar semantic fields, build a versioned JSONB request with
fixed field names, and hash PostgreSQL JSONB text with SHA-256. JSONB removes
property-order dependence. Transport metadata, line endings, mutable current
state, and result fields are excluded. Ordinary surrounding whitespace in notes,
reason, and references is normalized once before the immutable request is built;
idempotency keys must already equal their trimmed representation.

The unique Slice-1 scope remains:

`actor_scope_type + actor_scope_id + operation_type + idempotency_key`

The request fingerprint is then compared for exact same-key replay. A mismatch
is a deterministic conflict and performs no business write.

Committed replay is resolved before mutable business locks and fresh
eligibility checks. It revalidates immutable operation/request/result and source
identity evidence, while later mutable `payment.is_reversed` state does not erase
the historical collection fact. Fresh collection and reversal attempts continue
to require a currently unreversed source payment. `operationEventAt` is stored
and reconstructed as an explicit UTC string with microsecond precision, so its
durable identity is independent of session `TimeZone`.

## Reversal gross-capacity equation

Under the locked Order context:

```text
candidate_collection_coverage
= committed canonical collections
- committed canonical payment reversals
- candidate exact-payment reversal

candidate_outstanding
= max(order total - candidate_collection_coverage
      - settled debt reductions, 0)

candidate_delivery_outstanding
= min(delivery fee, candidate_outstanding)

candidate_collected_delivery
= delivery fee - candidate_delivery_outstanding

required_coverage
= settled monetary refunds + candidate_collected_delivery
```

The candidate is rejected unless:

`candidate_collection_coverage >= required_coverage`

Money refunds are not subtracted from collection coverage and do not recreate
debt. They remain separate committed movement facts.

## Activation boundary

Migration 124 must leave all writers with zero EXECUTE for `PUBLIC`, `anon`,
`authenticated`, and `service_role`, no public wrappers, and no repository caller
edge. PostgreSQL/migration-owner execution is used only by isolated verification.
No active reader may trust Slice-2 evidence and no current business output may
change. Cash activation is explicitly blocked until a later approved coordinator
atomically owns the required current-period drawer movement.

## Verification map

- static object/signature/security/contract tests;
- fresh isolated 001-124 rebuild and catalog/ACL/RLS/PostgREST checks;
- real writer success, exact replay, changed-payload conflict, actor/type scope;
- duplicate source, duplicate/full/partial/cross-payment reversal rejection;
- gross-capacity, refund, delivery, legacy-evidence, Cash/CliQ tests;
- independent-session duplicate and reversal races with zero partial rows;
- operation time captured once after locks and preserved on replay;
- UTC/Asia-Amman/Pacific-Auckland replay in both creation/replay directions;
- collection replay after canonical and legacy reversal, with unbound legacy
  reversal remaining fail-closed for fresh canonical reversal;
- valid-vs-valid changed-payload races in both launch directions;
- late migration-signature collision with full transaction rollback proof;
- representative transactional failure with no partial Slice-2 evidence;
- no current application caller, projection, report, or legacy writer change;
- canonical-LF Migration 124 fingerprint and post-123 authority inventory.
