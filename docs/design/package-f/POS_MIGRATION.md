# POS migration — 2026-10-09

Package F §6.3 / §4.1 / §4.2 only, baseline
`70bb9754c6974556cc8950050760dd4104612468`. Forwarded Claude visual review
accepted Orders;this task is POS presentation only. No Production/deploy.

## Contracts

- Preserve create_pos_sale_v2,all three line kinds,warehouse physical capacity,
  pricing,open-shift gating,immutable request/idempotency and multi-tab recovery.
  No reader/RPC/payload/role/migration changes. Shell and existing POS icon rail
  remain unchanged. Camera,parcel builder,customer creation,receipts and recovery
  remain reachable. Cash/CliQ/debt only;no Card tender.
- Desktop:grid and side cart. Below lg:product list and sticky checkout above
  BottomTabs;cart details/customer/cash controls accessible from the cart sheet.
- Owner clarification:customer selector displays name and phone only,exactly
  as returned. No debt line,unavailable marker,cached inference or extra read.

## Open owner question — deferred,not implemented

هل يعرض الكاشير دين العميل الحالي؟ يتطلب قراءة إضافية (للقراءة فقط) من
القارئ المالي الموجود — يُقرر لاحقاً كخطوة منفصلة باختباراتها.

## Required proof

AST compare all await/service/rpc/run*/openModal calls and request construction
against baseline;existing POS/recovery tests remain strict. Fixed light/dark
harness;390/820/1440 axe,no horizontal overflow/text escape,Latin digits,
always-visible mobile checkout;full quality,Gitleaks0,one commit/push/exact-SHA
CI and checkpoint. Stop for visual review before another screen.

## Implementation and parity

- Same live PosView controller/handlers;desktop190px minimum product tiles and
  380px cart. Below lg:product rows with add/decrease/current-mode quantity,
  sticky checkout and a single responsive cart sheet for customer/cash/details.
  Closing returns focus to the still-mounted cart trigger. Cash/CliQ/debt retain
  their exact existing codes. Parcel tab reveals the existing configuration
  chooser/builder;it does not invent a fourth request line kind.
- ProductGlyph uses the real photo/name initial and decorative nw tones. Stock
  comes from the existing warehouse-scoped helper,not global stock. Both packet
  and carton catalog prices are displayed;submission/pricing functions unchanged.
- New shared ResponsiveCartPanel uses the existing dialog stack/busy-close guard.
  SegmentedControl's disabled and StickyActionBar's hero tone are optional;
  defaults unchanged and permanently tested. Receipt dialog/focus/name and Latin
  date formatting added;existing print CSS/receipt facts/share/link paths retained.
- AST comparison with70bb975:27 await/service/RPC/run*/openModal expressions
  IDENTICAL;canonical trace SHA256
  `86f24afae716457dfe8c837d5c814ceab61d1d66cb30cde060ba01e3ff4b2d6c`.
  No service,store,writer,role,permission,reader,payload or migration changed.

## Harness and updated test selectors

Isolated preview:`node scripts/testing/run-isolated-vite.mjs admin 4173`.
`/e2e/package-f-pos-harness.html?theme=light` (or dark) uses actual PosView
with fixed read fixtures and the actual collapsed-POS shell prop. It rejects
non-loopback API configuration. Mutations are forwarded to the isolated API,
not fabricated as successful sales. These browser fixtures prove presentation
and adapter behavior;the existing pos-browser CI job supplies real DB proof.

- package-d-pos.spec.ts:unit select→named radio;cart sheet open/back when needed;
  quantity uses stable data identity instead of old white-text class;submit
  matches its new amount-bearing label. All physical-capacity/composition,
  unknown/reload/request/key/result assertions retained.
- package-d-pos-fullstack.spec.ts:only unit radio,amount-bearing submit and
  named receipt-close selectors. All committed replay/two-tab/zero-write and
  aftercare/damage/absence-proof checks untouched;no skips/retries/timeouts changed.
- phase6-package-c.spec.ts:the same line's visible quantity on phone instead of
  the hidden side cart;desktop still checks its cart heading. Every held-Enter,
  scanner focus,input andcapacity assertion retained.
- No old financial test weakened:the existing closed-shift message was kept
  after its static regression found it missing. New probe key expectation was
  corrected to the existing pos-v2:SHA256 protocol,with persisted-request equality.
- First focused run exposed hero-muted colour inheritance and a disconnected
  cart opener;fixed at shared tone and mounted-trigger boundaries. Axe/focus
  expectations stayed strict. New harness now passes actual collapsed prop;
  no shell changes. No blind waits,retries or timeout increases introduced.

Focused browser36/36 (18new POS plus existing POS/keyboard/dialog regression),
unit54/54,typecheck and changed-file ESLint strict PASS,retries0. Includes both
themes390/820/1440,axe,text containment,Latin digits,always-visible checkout,
modal back/focus,three-kind exact payload,closed shift and unknown reload/key.
Full quality/Gitleaks/commit/push/exact-SHA CI remain before delivery.

Final full local quality exit0:771Admin/189Customer/357Browser PASS,
59 pre-existing conditional skips,retries0. POS18/18,Orders32/32,Home24/24
inside the uninterrupted full run;typecheck/ESLint/build/SEO/isolation PASS.
External/Production requests escaped0. Gitleaks/exact-SHA CI follow.

## Approved test-tool correction — 2026-10-09

20910cb CI exposed two harness defects, not a proven POS business defect.
Exact package-d job113664368296 log at04:07:40.0996666Z/0997061Z:
`+ productName: 'نكهة أ'` / `- productName: 'نكهة ��'`, followed by
`package-d-pos-recovery-runtime.ts:86:10`. Separate Buffer coercion at a
UTF8 chunk boundary fabricated a content/hash difference. The shared
process-utf8.mjs decoder now sets stdout/stderr UTF8 before listeners.
Permanent regression splits `نكهة أ` at every byte boundary on both streams;
the original exact content/SHA assertions remain unchanged.

All previously unsafe captures found in testing runners were corrected:
- package-d-pos-recovery-runtime.ts (SQL capture);
- run-canonical-schema-runtime.mjs (SQL capture);
- run-phase6-package-a-runtime.mjs (SQL capture);
- run-phase2-configurable-receiving-runtime.mjs (two gate captures).
Other runners already use stream UTF8 decoding, buffered execFile decoding,
or raw inherited output; they were inspected and not unnecessarily changed.

pos-browser job113664368298 failed before mutations: bare fullstack HTML
had no CSS, so both responsive radio copies were visible. The harness now
loads src/index.css, self-hosted IBM Plex Arabic400/500/600/700 and an explicit
viewport, including its aftercare remount. No selector or existing test name,
case count, assertion, retry or timeout changed in this correction. No product
logic, RPC, service, migration, permission or workflow changes.
Fresh real-runtime/full-quality/exact-SHA proof follows before delivery.

Fresh focused proof:UTF8 regression2/2,typecheck and changed-file ESLint PASS;
package-d fresh001-132 exit0,including the exact recovery fingerprint and
real concurrent trigger races(deadlockDelta0). Styled pos-browser8/8 PASS
in1.9m,Chromium+Mobile WebKit,workers1/retries0,real authenticated RPC/DB,
Production requests0. Both owned isolated stacks cleaned after their runs.

Fresh full quality exit0:773Admin/189Customer/357Browser PASS,59existing
conditional skips,retries0;browser run14.0m. AST comparison proves all4
original fullstack test bodies and120 assertion calls identical to20910cb.
Only bootstrap styles/viewport/font changed in that spec. No owned test
containers/listeners remain. Gitleaks/staged integrity and new exact-SHA CI
must pass before visual-review delivery;no next screen is authorized.

## Owner-resolved read extension — 2026-10-09

The previously open customer-debt presentation decision is now explicitly
approved via135. Existing get_pos_customer_page adds balance using the exact
CRM phase42_customer_receivable_total_internal source and existing credit limit.
Only the selected customer shows debt/limit and an over-limit warning;no sale
block,no new request,no parallel balance,no mutation payload/recovery change.
Proof and delivery:READ_EXTENSIONS_135.md. Historical POS call-parity evidence
above remains valid;the previous no-added-financial-read prohibition applies
to the original visual migration,not this separately authorized extension.
