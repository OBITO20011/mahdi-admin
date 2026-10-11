# Receiving base units and packages — implementation and verification

## Owner decision and runtime proof — 2026-10-11

Exact package gross approved. The total,not rounded per-unit cost,is the source
of supplier payable truth. Database derives WAC to its existing six-decimal
minor-unit precision;legacy displayed unit cost is not used to recreate debt.
Base-unit adapter branch unchanged;literal payload contract test PASS.
Permanent runtime: npm run test:receiving:units:runtime,isolated001–137,real public
RPCs under authenticated owner. No simulated money/stock writes for the proof.
Product identities begin with zero stock/cost;all acquisitions run through RPCs.

| Case | PO payable = direct payable (minor units) | Quantity | Exact WAC (minor units) |
| --- | ---: | ---: | ---: |
| 1 package1.000/24 | 1000 | 24 | 41.666667 |
| 100 packages1.000/24 | 100000 | 2400 | 41.666667 |
| 1 package1.000/7 | 1000 | 7 | 142.857143 |
| 1.000/7 minus .123 line discount | 877 | 7 | 125.285714 |
| Same SKU1package +2base units at.050 | 1100 | 26 | 42.307692 |
| PO partial1of2packages | 1000 | 24 | 41.666667 |

All six PASS,including equality of both paths,receipt payable,supplier balance,
database-round WAC,unchanged purchase defaults/selling prices and PO status.
Runtime exit0,133s,temporary database stopped,no other owned DB touched. Evidence:
C:/Users/TOP/AppData/Local/Temp/nawasrah-receiving-unit-20261011/runtime.log.
Current adapter unit contracts6/6 PASS. UI implementation/verification continues.
PO unit-mode controls require existing search_admin_products read facts via the
already supported receiving-product service (per product,not partial cached
stock). No new SQL reader/RPC definition/grant. This is an added metadata read,
not claimed identical read-call counts. Writes retain existing endpoint/fields.

2026-10-11:owner accepts Package F screen transfer through d293ec3. Exact
delivery verifier PASS:quality38156327908 (21/21),secrets38156327919.
New scope:direct/PO receiving unit choice,POS unit labels,receipt/storefront
unit display. No RPC/migrations/permissions/Production/deploy changes.
Initial preflight/resume PASS;no implementation edits existed at that inspection
checkpoint. Implementation and completed verification are recorded below.

## Initial source inspection — resolved by the approved decision above

- Direct receiving already has packageQuantity,unitsPerPackage and full package
  price. directReceiptV2Lines sends gross=quantity*package price and physical
  units=quantity*contents. The requested base choice can force contents=1 without
  changing that contract. Current dropdown can misleadingly change purchase
  unit name while retaining contents;the requested explicit choice addresses it.
- PO receiving currently accepts physical base units only:receivedQuantity and
  unitCost. It has no retained package-price field. purchaseReceiptV2Lines
  rounds unitCost*1000 BEFORE multiplying receivedQuantity;ReceiveGoodsModal
  sends the same baseUnitName from the PO product. It does not currently have
  the direct-receipt name-versus-contents trap.
- Adding package price to PO UI by dividing would not always preserve entered
  money:package1.000 with24 units gives base cost .041666...,rounded .042;
  existing RPC payload gross becomes1008 minor units (1.008),NOT1000 (1.000).
  Deterministic Node arithmetic probe confirms this;not a DB/runtime claim.
- Current PO product read returns base-unit name but not package contents/name.
  Any package-capable PO form also needs these existing product facts,not guessed
  defaults from a partial cached page. No new reader has been introduced.

Owner choice:keep PO receipt base-unit-only for this step (accurate named-unit
  fields/stock preview),while implementing requested direct-receipt packages;
  OR authorize exact full-package gross in the existing PO RPC field,requiring
  an explicit client adapter extension and separate equivalence tests. Existing
  base-unit inputs must retain byte-identical payloads. No automatic rounding,
  rejection or allocation policy has been selected by the agent.

## Additional presentation findings

POS labels fixed to باكيت/كرتونة despite cart item.unit already carrying the
correct product name. Product cards/cart badges and mixed-unit total need display
correction only. Store ProductCard/ProductDetails already use unitNameAr and
saleUnitNameAr. Receipt share formatter prefers salePackage over item.unit;POS
sets salePackage even for a base-unit line,so that priority can mislabel an
individual sale. These are source findings,not implemented or runtime-verified.

## Implemented UI and contract changes

ReceivingUnitFields is shared under components/ui,named from the product base
unit. Direct receipt defaults to the existing package mode when contents>1;
base mode hides content/type,forces content1 in state AND payload. Switching
reloads product defaults;editable base-unit PRICE is a currency amount (three
decimals),not authoritative WAC. Package mode never recreates gross from it.
No-package products have only their named base-unit choice. Direct duplicate
SKU rows retain independent client-line identities;stock summary includes total
units and per-unit-name counts. PO starts with its previous base-unit values;
package quote is internal UI metadata,not an added RPC field. Quantity is bounded
by actual remaining base units. Existing metadata reader is added only to show
the product's real package default,not a guessed page-cache value.

POS global mode uses the most recently selected product unit (or the common
visible unit;before choosing among mixed products,the honest label is وحدة الصنف).
Product cards/cart badges always show each product's own unit;package label is
طرد without changing legacy_single_sku_parcel. Mixed cart total says وحدات صغرى,
not a false uniform باكيت. POS sale/recovery/payment/print/share handler bodies
AST-identical to d293ec3;receiving service sources/RPC definitions unchanged.
Local print now includes saved line.unit beside quantity. Receipt sharing now
prefers saved line.unit over product salePackage (regression test bottle/bag).
Store ProductCard/ProductDetails/Cart/public receipt already use stored unit
names;no customer-web changes required.

Focused browser16/16 PASS:Chromium/WebKit,light/dark,390/820/1440,axe and clipping,
mode price/content reset,base content1,package exact gross1000/physical24,
no-package bottle and same-SKU package+base lines. No retries. Harness:
/e2e/package-f-purchasing-harness.html?view=create-direct&receivingUnits=1&theme=light
(or view=receive/theme=dark). Runtime and browser have separate isolated evidence.

Test contracts updated without dropping payload/guard assertions:
- package-f-remaining-batch3:only direct/PO form exact AST pins updated for the
  authorized unit controls and PO metadata read;all other ten pins unchanged.
- supplier-receiving:old +/- and fixed package-label assertions now check the
  shared named integer quantity control,min/step and stock preview;all money,
  selling-price and DB guard assertions retained.
- package-d-pos-fullstack:only two radio selectors كرتونة→طرد;values and financial
  assertions unchanged. All old POS write/recovery tests remain in full quality.
- package-d-pos:fixture omits base_unit,so existing reader maps its unit to قطعة;
  old fixed باكيت selector changed to exact قطعة,all capacity assertions intact.
  First full quality reached398 browser PASS and one obsolete-selector failure
  (Chromium spec:17,waited90s for absent باكيت). Controlled stop before patch;
  no aggregate PASS claimed. Admin894/894,Customer189/189,lints/builds/SEO/isolation
  passed in that run. Complete corrected quality will be rerun;no retries or
  timeout changes,not a product/business correction.
Focused units19/19,prior contracts14/14,typecheck,targeted ESLint PASS.
Next:full quality,Gitleaks0/commit/push/exactCI,checkpoint and visual STOP.

## Fresh quality blocked — 2026-10-11

Owner-confirmed Codex restart interrupted quality-corrected;no final exit file
and no owned process remained. Fresh quality-resumed ran the SAME full command:
Admin894/894,Customer189/189,lints/builds/SEO/isolation PASS. Browser386 PASS and
one actual failure before controlled shutdown:desktop Chromium purchasing forms
and guarded confirmations dark (e2e/package-f-purchasing.spec.ts:44).
Trace/error-context pinpoints unchanged audit line12 waiting for finite native
animation.finished promises inside ReceiveGoodsModal;90s timeout BEFORE axe.
The screenshot/context shows the receiving form,not a money submission failure.
No assertion/color check was removed;no product/test repair or rerun authorized
after this failure. Exact animation state/root cause is not yet proved.
No aggregate PASS,commit,push or new CI. External quality-resumed-exit.json=1
after controlled stop;all task-owned processes/listeners stopped. Next owner
review on bounded motion-wait diagnosis/correction,then remaining delivery gates.

## Final local verification — 2026-10-11

Owner-approved independent TEST-ONLY motion consolidation committed ec1145d;
see MOTION_WAIT_CONSOLIDATION.md. Five specs/seven local waits now use the same
existing5s finite frame gate. Product/shared-helper/timeout/retry code unchanged
by that commit. AST485expectations/7data-state guards unchanged;target20/20 and
both-browser/light-dark repeat3 ALL5specs528/528 PASS. Customer category-grid
geometry waits do not precede axe and remain untouched as requested.

Fresh full npm run quality completed exit0:
- Admin895/895;Customer189/189;typecheck/ESLint/builds/SEO/network isolation PASS.
- Browser695 PASS,59 existing conditional skips,0failures/0retries (27.7m).
- Whole command2026-10-11T20:26:51.573Z–20:56:15.158Z;detached log and final
  exit file followed to completion in the same turn,no background handoff.
- All task-owned processes/listeners4173–4176 stopped;001–137,.github,
  customer-web,receiving services and auth unchanged;no138/Production/deploy.

External quality-final-motion.log/quality-final-motion-exit.json beside runtime
six-case logs re-read before delivery. All six direct/PO payable/WAC pairs are
exactly equal as in the table above;no base-price rounding creates supplier debt.
Receipt commit/Gitleaks/push/exact-SHA CI and owner visual review follow.
# Owner-approved explanation cleanup — 2026-10-12

Removed the old duplicated "الكمية التي ستدخل المخزون" sentence from the direct receipt banner. The single ReceivingUnitFields stock preview remains; calculated unit cost, total and before/after detail remain unchanged. ReceiveGoodsModal has no duplicate sentence. Permanent source/browser assertions reject its return in either form. No RPC, payload, validation or stock calculation changed.
