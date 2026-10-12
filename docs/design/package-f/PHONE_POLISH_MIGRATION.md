# Phone presentation round — 2026-10-12

Owner-approved scope:phone/tablet portrait<1024 only;no missing phone function,no RPC/payload/validation/confirmation/permission/migration change. Desktop>=1024 keeps its existing content and controls. Checkout focus correction and strict remediation remain forbidden. Commit one or two items at a time;detached logged full quality,Gitleaks0,push,exact CI,then final visual stop.

## Items1–2 — customer profile and rare row actions

In progress:shared MobileTabs/sections retain existing mounted readers;default Summary (aging/stats/notes),Orders,Addresses. No fake statement tab. Sticky profile head and bottom payment;the existing payment modal/payload remain unchanged. The separately approved statement reader is a DOCS-ONLY future scope in CUSTOMER_STATEMENT_SCOPE_DRAFT.md.

Shared MobileActionMenu passes original button elements/handlers through. Primary phone/WhatsApp/edit/payment/receipt-detail controls stay outside. Rare actions:customer block/unblock/delete,expense reversal,supplier-receipt cancellation,staff password/account enable-disable. Form submit/cancel and normal inventory-count confirmation flows are not hidden. Original confirmations remain unchanged;receipt cancellation's sheet label explicitly says cancellation/reverse inventory rather than pretending it physically deletes an audit record.

Existing source contracts PASS15/15 across Customers and batches3–5;new parity/helper8/8. Six modified live files have identical business/event/value/confirmation ASTs to289f398. The only two comparison exceptions are explicitly verified presentation data:Crm portrait breakpoint767→1023 and the five MobileTabSection identifiers;all old native values remain compared. Typecheck and affected strict ESLint PASS.

Focused browser:Customers+profile/menu42/42;expense-menu/reversal6/6;receipt-menu and staff password/activation6/6,Chromium+WebKit,both-theme presentation and1024/1440 desktop content/position checks,axe/clipping,no retries. Initial keyboard test found the fixed payment footer precedes tab contents in DOM;footer moved after sections,still fixed visually,then all42 passed. Initial820 test selected hidden buttons too;it now asserts the exact three visible controls plus separately tested named block/delete sheet.

Detached full quality12 COMPLETE exit0,02:31:03.693–03:11:28.884UTC:Admin908/908,Customer189/189,typecheck/strict lint/builds/isolation PASS;browser719PASS+59existing conditional skips,retries0. Log/exit:C:/Users/TOP/AppData/Local/Temp/nawasrah-phone-polish-20261012/quality12*. No Production/deploy or migration change. Gitleaks/commit/exactCI required before declaring delivery.

Test presentation updates:Customers<1024 explicitly selects Orders before checking its original money/date text,then Summary for aging;footer test selects Orders and measures its last visible section. At820 row controls become phone/WhatsApp/more,with the two original destructive buttons reachable inside the named44px sheet. Existing expense/staff mutation assertions are retained;phone tests open the action sheet before selecting their unchanged controls. No retries,timeout increase,assertion removal or financial count relaxation.

## Items3–4

Approved and not started:Purchases two primary KPIs plus mobile disclosure;Storefront settings identity open/other sections collapsed,all native fields mounted and save control unchanged.

## Item5

Approved and not started:minimum12px functional phone text,including Assistant. Responsive desktop sizes remain unchanged;list any intentionally smaller nonfunctional exceptions only with evidence.
