# Vite optimizer readiness — diagnosis only

Owner approved diagnosis of the existing isolated-vite-cache failure,not a
product/test/config repair,timeout change or delivery. Main remains bf0ef2b;
the previously approved strict candidate is still uncommitted.

## Established evidence

- Original config gate18:54:58.458–18:59:11.825UTC on2026-10-13:
  typecheck/ESLint PASS,1015/1016 units PASS. The shared-cache reproduction
  fails at tests/isolated-vite-cache.test.ts:48 while waiting for serverB's
  `metadata.optimized['lucide-react']`. The existing15s deadline expires;
  complete case23.339s. It never reaches the HTTP504 assertions.
- Same original case,unchanged assertions/deadline,one sequential process:
  current(strict candidate)10/10 PASS in49.404s;clean bf0ef2b worktree
  10/10 PASS in46.640s. All20 explicitly prove504/Outdated Optimize Dep.
  Baseline and current test source are canonically byte-identical;the same
  installed dependencies were reused by a temporary junction,no install.
- Collection21:04:56.708–21:06:44.627UTC:tracked main files unchanged.
  Minimum sampled available memory1531MB(current)/1533MB(baseline).
  Whole-machine node process count BEFORE each trial5–6,not a failure-time
  count. No other project QA server or DB runtime was launched concurrently.
- Windows System log for the original failed gate has zero events42/107/2004:
  no recorded sleep/resume/resource-exhaustion event in that interval. This
  does not prove CPU/memory/disk pressure was absent.

## Extra tracing outside the checkout

An external temporary copy of the shared-cache case preserved configuration,
requests,15s/10ms readiness loop and all original assertions. It only observed
phase timing,optimizer metadata and logger info/warn/error. One current and
one baseline trace passed;no logger errors were emitted.

| Observation | Current | Baseline |
|---|---:|---:|
| B requests idle,from process start | 1731.91ms | 2151.74ms |
| B lucide-react optimized | 2071.54ms | 2533.13ms |
| Gap after requests idle | 339.63ms | 381.39ms |
| Final old-A request | HTTP504 | HTTP504 |

At requests-idle the dependency was still in `discovered`,not `optimized`,
with holdUntilCrawlEnd=true. Thus requests-idle is not optimizer-commit
completion;the existing explicit optimizer wait remains necessary.

Installed Vite code publishes optimized metadata after commitProcessing.
Its optimizer error handler calls logger.error. The original test creates
createLogger('silent') and captures only logger.info,so a real optimizer
error would not be present in the failed test's saved output. The original
failure therefore cannot distinguish a late optimization from failed
optimization. No underlying exception was recovered or reproduced.

Additional observation,not a proven cause:Vite treats the supplied port0 as
its default5173;serverB logged trying another port. This is not a random OS
port allocation. No port-setting repair is authorized or implemented.

## Verdict and bounded next proposal

No deterministic strict regression or product defect is established. The
exact root cause of the single earlier timeout remains unproven;do not label
it memory pressure,sleep or harmless flakiness as a confirmed fact. Isolated
10/10 runs are diagnosis evidence,not acceptance of the failed full unit gate.

Proposed next step REQUIRES owner approval:capture logger.error/warn and an
optimizer snapshot(actual port,optimized/discovered IDs,scan state) when the
same15s readiness assertion fails;preserve that assertion,all504 checks and
all deadlines. Then rerun the strict config gate once to obtain full-context
evidence. No retries,extra time,dependency change or product repair proposed.

Evidence files:Temp/nawasrah-vite-readiness-diagnose-20261014.log and
-result.json;external trace helper in the same Temp directory. All task-owned
probe servers were closed. The clean managed baseline worktree is archived
after unlinking its dependency junction;main node_modules is untouched.
No commit/push/Production/deploy or database access in this diagnostic step.

## Owner follow-up —2026-10-14

Owner approves failure-only logger/optimizer evidence and ONE strict gate.
The existing15s assertion and10ms poll are unchanged. On that assertion's
failure only,emit ports/dependency IDs/scan state/bounded logger messages/
available memory and rethrow the same error. Original silent warn/error
methods are still forwarded;no request/server/config/port changes.
Permanent tests prove silence on success and identical error propagation
with the unchanged deadline. Existing AST contract protects every original
assertion. Do not rerun automatically or treat earlier standalone PASS as
the gate. No product/migration/Production/deploy or retry/timeout change.

The ONE approved gate completed21:21:09.879–21:24:29.508UTC on2026-10-13
(2026-10-14 Amman):exit0 and all files frozen. Admin1019/1019,Customer191/191,
type/lints/build/isolation and strict measurement0 PASS. The original504
reproduction passed in2.832s;no new readiness failure/diagnostic occurred.
The three new diagnostic contracts and32 assertion/runtime contracts passed.
The previous exact timeout cause remains unproven,not silently fixed or
waived. Continue the original approved strict delivery gates:staged Gitleaks0,
normal commit/push and mandatory full exact-SHA CI. No code/DB deployment.
