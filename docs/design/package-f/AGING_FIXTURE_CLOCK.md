# Aging fixture clock correction — 2026-10-12

TEST INFRASTRUCTURE ONLY. Source001–137,products/readers/writers/permissions/UI,
browser specs and CI workflow bytes remain unchanged. Receiving9435ebd remains
the visual candidate;the clock correction is an independent commit.

## CI evidence and deterministic reproduction

Exact9435ebd run38174379530,job114573508731 failed137 overdue actual3 expected2.
Old log bootstrap/fixture phase:2026-10-11T20:59:56.5146718Z =
2026-10-11 23:59:56.5146718 Asia/Amman. Failing query assertion:
2026-10-11T21:00:00.5767788Z =2026-10-12 00:00:00.5767788 Asia/Amman.
Per-INSERT/query timestamps and the extra identity were NOT logged;these are
observed execution bounds,not invented per-statement timestamps. The unchanged
fixture seeds customer404 completion AmmanDATE-30,then separate connections
can read it on the next day. Only its30-day fixture crosses the >30 boundary.
Old CI had19 successful jobs;the137 failure also failed its delivery aggregate.

Permanent deterministic DB proof replays the exact reviewed allocation CTE
prefixes from136/137 as read-only SELECT projections,binding their sole clock
input to23:59:59/00:00:00 Amman. NO installed function is replaced,no migration
is text-patched and no server/wall clock is changed. Completion2026-09-11
00:00:00+03 is30 days at2026-10-11 23:59:59+03 and31 days at2026-10-12
00:00:00+03:both projections returned[{ageDays:30,overdue:0},
{ageDays:31,overdue:1000}] identically. REAL authenticated136/137 RPCs additionally
test30/31 fixtures derived from the actual database clock:aging overdue0/1000,
directory count0/1 and exact identity agree. Proof rows are rollback-only.
This is controlled-clock projection evidence plus real RPC boundaries,NOT
claimed historical-time RPC execution. Normal fixture proofs use unmodified
CURRENT_TIMESTAMP and the original installed functions.

## Correction and audit

aging-fixture-transaction.mjs holds ONE PostgreSQL backend/transaction for
fixture writes,baseline/after JSON,financial filters,all pages,136 and phase42
oracles. Existing request BEGIN/COMMIT/ROLLBACK wrappers become savepoints;
function bodies untouched. READ ONLY calls enforce transaction_read_only in
rollback-savepoints. A real forbidden UPDATE probe proves enforcement/error
recovery. SQL errors still reject;expected errors roll back their command,not
the suite. Both stdout/stderr markers and UTF-8 prevent late-error false success.
No retries,time avoidance,clock skipping,random shifts,timeout or expectation
changes. TransactionAt,AmmanDATE andbackend are logged/asserted before/after.
Bulk scale seeding keeps its existing transport;ALL following compared reads/
oracles/baseline-after share one clock. Original warmups/samples/p95/60s unchanged.
The transaction commits before existing DB lint and closes before DB stop.

Changed runners:run-package-f-debt-aging-runtime.mjs and
run-package-f-crm-filters-runtime.mjs. All99 existing assertion ASTs unchanged:
56 in136,43 in137. Explicit7/8 and30/31,00:00:00/23:59:59 six136 cases,manual137
identities and expected sets retained. No other elapsed-day fixture runner was
found in the date/aging audit:136 baseline SQL remains immutable;scale setup
already derives start_at in its own transaction;UI/unit aging fixtures use fixed
ages/dates. Golden-day/report/monitoring clocks test periods/freshness,not these
aging boundaries,and are outside this bounded correction (unchanged).

## Verified local evidence

- DB136 PASS:canonical255000,FIFO,unknownAge,all roles/ACL/zero writes,sixboundaries
  and DB lint. Backend302,transactionAt2026-10-11T21:15:16.521284Z identical.
- DB137 PASS:manual6cases,33old JSONs,exact filters/identities/paging/all roles/
  ACL/unknown-age exclusion/zero writes/DB lint and midnight proof. Backend294,
  transactionAt2026-10-11T21:16:27.952238Z identical. Both serial runners exit0;
  owned containers stopped,unrelated n8n untouched.
- Static11/11,full Admin898/898,typecheck/ESLint PASS. No assertions reduced.
- No local browser rerun:all source/harness/browser bytes identical to9435ebd,
  whose complete local quality passed895Admin/189Customer/695browser+59knownskips.
  Fresh full exact-SHA CI is mandatory before handoff of this corrective commit.
