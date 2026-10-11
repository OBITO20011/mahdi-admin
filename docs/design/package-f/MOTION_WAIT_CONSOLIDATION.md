# Package F motion-wait consolidation — 2026-10-11

Owner-approved TEST-ONLY correction after purchasing dark Chromium timed out
at the unchanged local finite Animation.finished wait,before axe. No product,
shared gate,CI,timeout,retry,fixture or financial assertion changes here.

Seven local waits now call the EXISTING waitForPackageFMotion in five specs:
package-f-purchasing (1),package-f-auth-assistant (1),package-f-cash (1),
package-f-more (3),package-f-products (1). It discovers running/pending/paused
finite motion on rendered frames,ignores Infinity only for waiting,and fails
closed with diagnostics at5000ms. All data-state=open/opening guards retained.
The existing accessibility helper still runs unmodified axe after stabilization.

customer-category-grid.spec.ts is unchanged:its two local waits precede grid
geometry assertions,NOT axe,and that file has no axe analysis. Owner conditional
instruction therefore does not authorize changing its separate geometry gate.

Permanent static AST guard in tests/package-f-accessibility.test.ts rejects
direct .finished and ['finished'] access in every dynamically discovered
e2e/package-f-*.spec.ts (comments/strings do not count as executable access).
Existing two gate/axe contracts retained;static3/3 and targeted ESLint PASS.
AST comparison against d293ec3:all485 expectation call nodes and7 data-state
guards unchanged across the five specs (76,68,191,70,80 respectively).

Verification (same browser settings,local retries0,2workers):
- purchasing forms and guarded confirmations dark,desktop Chromium repeat20:
  20/20 PASS,2.6m,maximum shared axe-gate wait125.5ms.
- ALL five changed specs,Chromium and WebKit,light/dark,repeat3:
  528/528 PASS,31.7m (2026-10-11T19:53:07.445Z–20:24:48.352Z),exit0.
- Earlier two commands selected NO tests due anchored full-title grep / Windows
  shell quoting;not counted as test attempts or evidence. Direct CLI argv and
  discovery verified exactly20 before the successful run. No test retries added.

External logs/exits: C:/Users/TOP/AppData/Local/Temp/
nawasrah-receiving-unit-20261011/motion-target20-direct* and motion-files-repeat3*.
The failed pre-correction trace is preserved externally as
purchasing-dark-before-motion-trace.zip. Complete quality and receiving delivery
follow separately;this document does not claim their pending result.
