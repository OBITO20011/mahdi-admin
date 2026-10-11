# Package F batch7 — pre-change colour inventory (2026-10-11)

Baseline:1272a786583842afac01957287bff72c1b6510c2. Owner-approved presentation only.
No RPC/payload/state/event/permission/validation/migration/workflow changes.

index.css:134 direct html.theme-light [class~=...] selector occurrences;43 rule blocks
contain legacy class selectors (including :is/nested selectors). Entire obsolete
compatibility sheet is retired only after its remaining users migrate to tokens.

| File | Fixed-family utility occurrences before |
|---|---:|
| src/components/common/AppErrorBoundary.tsx | 6 |
| src/components/layout/AdminToast.tsx | 12 |
| src/components/modals/AllModals.tsx | 19 |
| src/components/modals/BrandsModal.tsx | 37 |
| src/components/modals/CategoriesModal.tsx | 62 |
| src/components/modals/UnitsModal.tsx | 44 |
| src/components/ui/form-fields.css | 2 |
| src/features/barcode/BarcodeCameraCaptureModal.tsx | 22 |
| src/features/crm/AddAddressModal.tsx | 42 |
| src/features/crm/AddCustomerModalContent.tsx | 26 |
| src/features/crm/CustomerEditModal.tsx | 32 |
| src/features/dashboard/ChartsSection.tsx | 69 |
| src/features/dashboard/KpiCards.tsx | 91 |
| src/features/dashboard/QuickActions.tsx | 34 |
| src/features/dashboard/SmartLowStockAlertBar.tsx | 82 |
| src/features/dashboard/WidgetsSection.tsx | 91 |
| src/features/inventory/ClearInventoryBalanceDialog.tsx | 58 |
| src/features/inventory/InventoryOpeningSetupModal.tsx | 121 |
| src/features/inventory/StockCountModal.tsx | 70 |
| src/features/inventory/WarehouseTransferModal.tsx | 61 |
| src/features/more/adminNavigation.config.ts | 5 |
| src/features/pos/BarcodeScannerModal.tsx | 57 |
| src/features/products/ProductDetailModal.tsx | 1 |
| src/index.css | 153 |

Counts are lexical occurrences,not unique utilities. Includes all legacy families,
not just slate/blue. Active auxiliaries and retained legacy dashboard components
are recoloured too; no component/flow is removed. COLORS export has no repository
consumer but is preserved with semantic CSS variables instead of a second palette.

## Exceptions

Legacy Tailwind-family exception allowlist: **empty**. No brand/print use requires
a slate/blue/etc utility. Permanent guard scans every file recursively under src.
The fixed literal colours in design-tokens.css are the approved single palette,
not an exception for old utilities. Existing neutral/black shadows and explicit
white-paper print CSS remain presentation infrastructure,not legacy family tools.
App browser theme-color metadata is unchanged (auth source byte pin);it is native
PWA chrome metadata,not a screen utility. No authentication/session edit is authorized.
Barcode camera viewport stays black for live video;overlay/background/text migrate
to tokens,not the video contents. Existing token values are unchanged.

## Motion and deferred review

waitForPackageFMotion already tests effect.getTiming().iterations !== Infinity.
Infinite lock pulse is never awaited;its DOM remains included in axe. The bounded
gate correction re-discovers finite native motion on rendered frames rather than
awaiting a stale captured finished promise;paused motion still blocks analysis.
Explicit5s frame deadline fails with target/property/state/time diagnostics;
Infinity exclusion unchanged. Test-tool correction commits separately first.
Assistant phone 9–10px text stays deferred to the phone review.
After delivery STOP for visual review;types and checkout work are not started.
