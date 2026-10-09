# Owner-approved reader extensions — 2026-10-09

Inventory f8d88ac accepted visually and exact-SHA CI15/15. This separate task
adds only read facts and small POS/Inventory presentation corrections via135.
Historical001–134,write paths,permissions/grants and sale validation stay unchanged.

## Invariants / focused break matrix

- POS page keeps every existing field,order,search and pagination bit identical.
  New balance uses `phase42_customer_receivable_total_internal`,exactly CRM's
  source,only for paged customers. Credit limit is the existing customer field.
  Partial payments + debt-reducing Return match CRM balance exactly;zero debt=0.
  A limit warning is display-only and must never disable Cash/CliQ/debt checkout.
- Inventory preserves all existing fields/filters,WAC valuation and scope.
  New `active_items` counts active non-master SKU rows across the same complete
  scoped catalog;old `total_items` remains unchanged including inactive.
  `available` is `available_quantity>0`,consistent with existing low/out logic,
  before paging,including reserved-stock,branch/warehouse and search probes.
  New `available_stock` chip count comes from the same scoped whole catalog.
- ACL/owner/search_path snapshots are identical before/after. Anon,no ERP role
  and excluded roles reject as before. No new wrapper or private authority.
- Real134/135 JSON equality after deleting only these named additional fields;
  no timestamps or other fields exempted. Read RPCs leave durable state unchanged.
- Full scale:5000 SKU,10000 customers,150000 orders,200000 payments and1200000
  movements as in Package E fixture;3warmups+20samples,p50/p95/max,both p95<1s.
- UI:show selected-customer debt/limit warning without new calls;restore the
  server-side available chip and active KPI;hide unavailable row-value column;
  remove quantity emoji and label reorder thresholds in the actual unit.

## Verification / delivery

Focused real DB debt/payment/Return,JSON/ACL/zero-write and scale proof,focused
Chromium/WebKit UI,full quality,Gitleaks0,one independent commit/push,exact-SHA
CI and official checkpoint. STOP for owner/Claude visual review. No Production,
deploy,automations or next screen. Results/hash recorded after factual proof.

## Focused verified evidence

Fresh001–134 plus explicit135 PASS. Real POS debt100.000,two partial Cash
payments20.000+15.000 and sellable Return20.000 leave45.000;POS and CRM return
the exact same customer id/balance. Zero-debt customer=0. Reserved-only scoped
stock is unavailable. Active/non-active counts and complete available count
are independently checked. All nine old JSON snapshots are literally identical
after removing only the four named added fields;owner/ACL/search_path/signature
and volatility snapshots identical. Authenticated excluded role and anon reject.
Read RPCs execute in READ ONLY transactions. DB lint has only the16 established
unused-parameter warnings for deliberately disabled legacy functions;no new issue.

Focused static/unit16/16,typecheck PASS;Chromium/WebKit50/50,retries0,including
selected debt/limit warning without sale blocking and the actual InventoryView
available-status RPC adapter. Existing business-call AST traces remain identical.
Initial test-authoring corrections used the actual long receipt key/UUID,
family-inherited price and CRM phone-search contract,not changed product logic.
Fixed135 canonical-LF SHA256:
`2F699CAC9EB167C1A44838EE9CF72894C0F7D47846125F698C211E2592EE3B52`.
## Full-volume verified performance

Canonical Package E full fixture,not smoke:5000 SKU,10000 customers,150000
orders,5000 actual modern POS/Replacement/Return operations,200000 payments,
1200000 movements. Old JSON/ACL parity PASS;available and active independently
counted5000 while the visible page is24. Same60s measured statement ceiling,
3warmups+20samples,4 DB CPUs,no timing/DB-memory or evidence-policy relaxation.

| Reader / request | p50 ms | p95 ms | max ms |
|---|---:|---:|---:|
| POS customer page |57.366|94.540|118.811|
| POS customer search |48.342|94.280|96.736|
| Inventory all |100.038|170.449|193.806|
| Inventory available |114.591|154.690|179.897|
| Inventory page209 |113.260|169.662|185.307|

All p95<1000ms PASS. First scale attempt completed data/JSON/ACL but failed in
the new runner's last-line JSON parser on pretty EXPLAIN's closing bracket.
Whole-output JSON decoding corrected,permanent regression added4/4;the full
fixture and measurements rerun successfully. No SQL/threshold/assertion masking.
Owned DB stopped normally,no-backup.

## Final local quality

Full npm run quality exit0:Admin/Customer typecheck,ESLint,unit tests,build and
isolated Customer SEO PASS;389 browser tests PASS,59 existing conditional skips,
retries0,in15.3m. Dedicated network isolation Chromium/WebKit PASS:escaped
external/Production0,blocked canaries4 and unexpected-host attempts verified4.
Historical001–134 unchanged. No added timeout,retry,skip or weakened financial,
inventory,authorization,recovery or business-call assertion. Gitleaks0,one
independent commit/push and exact-SHA CI remain delivery gates;the official
checkpoint records their final result. STOP for visual review,no next screen.
