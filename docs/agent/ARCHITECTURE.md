# Architecture invariants

## Authority boundaries

- PostgreSQL/Supabase is authoritative for business state. UI state and browser storage are never financial or inventory truth.
- Inventory, WAC, debt, refunds, payments, Return settlement, and reversal effects must be atomic, authenticated, idempotent, auditable, and replay-safe.
- Browser recovery evidence is durable consistency evidence, not cryptographic protection against a device owner modifying all browser data.
- Public/customer operations go through the approved Gateway/RPC contracts; no client-controlled price, cost, inventory, or settlement truth.

## Quantity vocabulary

- Sales Parcel: commercial sales bundle. It has no independent inventory balance.
- Receiving: Base Unit or Purchase Package from a supplier.
- Purchase Packages convert to Base Units at SKU/Flavor inventory level.
- Never describe supplier receiving as receiving a Sales Parcel.

## Phase 4 boundaries

- Return/Replacement versioned operations use immutable identity, actor-scoped idempotency, state-machine and outcome binding.
- Phase 4 writes serialize in the canonical root Order domain before child/evidence writes; replay is read-only.
- Operational settlement must have durable relational evidence for the exact operation and expected inventory/financial effects. Foundation-only settled-looking state is not operational success.
- Same-key committed replay returns the stored immutable outcome with zero duplicate effects, including after the eligibility deadline.
- Phase 4.2 is Return settlement. Do not silently expand it into Supplier Claims, full Accounting Core, or Phase 4.3.

## Change discipline

- Historical migrations are immutable. Add a migration only after a bounded design proves it necessary and the owner authorizes it.
- Preserve lock order and identify every acquired resource before taking later-ranked locks; changed discovery causes rollback/safe retry, not late earlier-ranked lock acquisition.
- A change that requires Backend/Gateway contract expansion or new business policy stops for owner review.
