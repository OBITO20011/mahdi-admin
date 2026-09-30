# Phase 5 Slice 2 authority and coexistence map

Status: OWNER-CLOSED after independent re-sign-off; private and inactive.

Canonical-LF Migration 124 SHA-256:
`4B6A50442DDF0DBEE24233CB9036469B428CE20991E0315EB6C1FAFE4BDD4F41`

## Authority boundary

| Surface | Owner | Security | Public/app grants | Current caller edges | Authority in Slice 2 |
| --- | --- | --- | --- | --- | --- |
| `phase5_private.commit_customer_collection_v1` | `postgres` | `SECURITY INVOKER`; `search_path=pg_catalog` | none | none | private-runnable in isolated owner verification; not active business authority |
| `phase5_private.commit_customer_payment_reversal_v1` | `postgres` | `SECURITY INVOKER`; `search_path=pg_catalog` | none | none | private-runnable in isolated owner verification; not activatable until the future Cash coordinator owns drawer movement |
| `phase5_private.validate_customer_collection_operation_v1` | `postgres` | `SECURITY INVOKER`; `search_path=pg_catalog` | none | writer/internal test only | central exact replay validation |
| `phase5_private.validate_customer_payment_reversal_operation_v1` | `postgres` | `SECURITY INVOKER`; `search_path=pg_catalog` | none | writer/internal test only | central exact replay validation |
| Existing public payment/reversal writers | unchanged | existing contract | unchanged | existing application paths | remain production-authoritative during inactive coexistence |

`PUBLIC`, `anon`, `authenticated`, and `service_role` have neither schema usage
nor function execution. There is no public wrapper and no source caller under
`src/`, `customer-web/src/`, `supabase/functions/`, or repository-managed
background workers.

## Canonical evidence boundaries

- Collection evidence is one-to-one with one active Cash/CliQ
  `customer_payments` row and exactly binds actor, order, customer, amount,
  tender, reference, and source Shift evidence.
- Reversal evidence is one full reversal of one exact canonical collection.
  Partial reversal is structurally impossible through the foreign key and the
  writer has no amount parameter.
- Original collection tender and reversal tender are independent committed
  facts. Cash reversal records the current locked open Shift. CliQ reversal
  requires its actual reference and records no Cash Shift.
- Replay is selected under the actor/type/key advisory gate before acquiring
  mutable business locks. Its validator proves immutable historical binding and
  returns the original UTC-canonical result without reapplying fresh eligibility.
- A later canonical or legacy reversal does not erase an already committed
  collection replay. An unbound legacy reversal still makes a fresh canonical
  reversal and gross-capacity derivation ambiguous, so that fresh path fails
  closed and cannot adopt or backfill legacy state as canonical evidence.
- A settled legacy Return with positive merchandise value but no authoritative
  debt/refund split also fails closed. No current-state guess or backfill is
  permitted.
- A settled versioned Return contributes debt/refund capacity only after the
  central Phase 4.2 validator re-proves its operational result, coordinator,
  inventory-effect, and durable-evidence binding.

## Gross-capacity dependency

The Slice-2 reversal candidate is checked under the root Order lock against:

```text
candidate collection coverage
= canonical collections - canonical reversals - candidate reversal

candidate outstanding
= max(order total - candidate collection coverage - settled debt reductions, 0)

required coverage
= settled monetary refunds
 + (delivery fee - min(delivery fee, candidate outstanding))
```

The candidate must leave coverage greater than or equal to required coverage.
Refunds are not subtracted twice and never recreate debt.

## Activation prohibition

Slice 2 deliberately does not update legacy projections, mark the source
payment reversed, or create a cash-drawer outflow. Those omissions are safe only
because the writers have zero application reachability. A later owner-approved
activation must atomically align the authoritative writer, projection/legacy
guards, and—when the reversal tender is Cash—the current-period drawer movement.
Until then this candidate is evidence-complete but non-activatable.
