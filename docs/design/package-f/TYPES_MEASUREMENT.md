# Admin React type measurement —2026-10-10

Owner-authorized measurement only,baseline47c958dac0019f28d21d9ac53881b2838fdd304c.
Separate managed worktree;no primary source/package/lock/config changes.
npm ci and @types/react@19/@types/react-dom@19 installed with scripts disabled.
Resolved React/ReactDOM19.2.8,types19.3.0,TypeScript5.8.3.
Ran tsc --noEmit --pretty false with EXISTING tsconfig;strict was NOT enabled.
Compiler exit2:11 diagnostics in8 files(8 source diagnostics,3 test diagnostics).
This is not a strict-mode audit or proof that all runtime defects are absent.

| File | Errors | Diagnostic |
|---|---:|---|
| src/components/common/AppErrorBoundary.tsx:46 | 1 | TS2416:declared setState narrows React's inherited overload |
| src/features/accounts/AccountsView.tsx:24 | 1 | TS2322:FilterChips generic string versus CustomerSection setter |
| src/features/dashboard/DashboardHome.tsx:75 | 1 | TS2322:SegmentedControl generic string versus day/week/month setter |
| src/features/dashboard/SmartLowStockAlertBar.tsx:240 | 1 | TS2339:DashboardLowStockAlert lacks unitsPerPackage |
| src/features/inventory/InventoryView.tsx:295,342,362 | 3 | TS2322:filter generic;TS2322:DetailPanel ref absent from DivProps;TS2339:Product lacks movementCount |
| src/stores/useAppStore.ts:2214 | 1 | TS2345:effect cleanup returns boolean from Set.delete rather than void |
| tests/package-f-remaining-batch1.test.ts:114 | 1 | TS2769:createElement data-unsaved absent from HTMLAttributes |
| tests/package-f-remaining-batch3.test.ts:157,165 | 2 | TS2769:createElement data-probe/data-unsaved absent from declared props |

## Source-grounded behavioral triage(no fixes)

No missing required dialog prop,wrong live business prop,or wrong monetary
value type reported.Confirmed active financial/inventory behavioral defects
among these11 diagnostics:0.This is bounded source triage,not runtime re-audit.

- movementCount exists in InventoryProduct and the reader maps movement_count;
  historyProduct is typed as base Product,losing static metadata but retaining
  the runtime object.No count was guessed or recomputed.
- DetailPanel spreads remaining props onto its aside,including ref on installed
  React19;public DivProps omits ref.This is a type-contract repair obligation.
- SmartLowStockAlertBar uses unavailable unitsPerPackage with fallback12:unsafe
  if revived,but no src import/caller exists;dashboard-home test forbids it in
  active Home.Dead legacy display,not a current stock mutation.Do not revive
  without authoritative package-size evidence.
- Filter/period options currently come from bounded explicit option lists;
  generic inference errors do not introduce arbitrary input at runtime.
- AppErrorBoundary's declare-only signature is erased,not a setState override.
  Store unsubscribe still executes Set.delete;React ignores its boolean result.
- The3 test errors concern createElement data-* object typing,not weakened or
  failing financial assertions.No tests or compiler rules changed here.

Primary HEAD/status/diff fingerprint before AND after measurement matched:
HEAD47c958d;only pre-existing ACTIVE_TASK.json metadata dirty;
diff SHA2567304cacd4f248074997eac2dcd75a791cb777952794efbf17def4bf1a557387a.
Managed worktree removed(archive keeps recoverable install-manifest snapshot);
git worktree list only primary;temporary node_modules removed.
Root package.json/package-lock.json/tsconfig unchanged.
Full React typing/strictness remediation remains separate AFTERbatch7.
