# Test snapshot and local memory — 2026-10-12

## Step1:immutable isolated Vite snapshot

Only scripts/testing/isolated-vite-server.mjs enforces server.hmr=false and
server.watch=null for isolated QA servers. This also stops Tailwind's watched
JSON/Markdown full-reload path;filtering one websocket path alone is insufficient.
Normal npm-run-dev/Vite configuration,production builds,ports,per-server caches,
API isolation,assertions,retries and timeouts are unchanged. Never edit tracked
files (including docs/checkpoints) during ANY verification process;generated
fixture files are isolated under mkdtemp and live logs stay outside the checkout.

Permanent real Chromium control:ordinary Vite+Tailwind reloads an open fixture
when docs/agent/ACTIVE_TASK.json mtime changes and loses input;the same touch
under startIsolatedVite keeps navigation count0,timeOrigin,input and focus.
Document content SHA stays identical. No tracked document is touched by this test.

Focused watch+cache4/4 PASS,TypeScript and strict affected ESLint PASS. The new
fixture initially used port0,which Vite maps to5173;it now uses distinct4197/4198,
without altering another server or an existing timeout/retry/assertion.
Detached quality-snapshot COMPLETE exit0,05:53:17.972–06:39:28.159UTC:
Admin912/912,Customer189/189,browser745PASS+59existing conditional skips,
retries0;types/lints/builds/isolation PASS. Source frozen throughout;owned
servers stopped. Gitleaks/independent commit/exact CI precede Step1 delivery.

Step1 delivered ba1d0f059b896bcd367562e45fb5eee1ca3a5338 after staged Gitleaks0;
exact quality38213772814 all21/21 and secrets38213773098 PASS.

## Step2:local browser worker budget

At local Playwright startup,os.freemem below4GiB selects1worker;at/above4GiB
selects2,max2 even on a large machine. Invalid memory evidence selects1.
This applies to the browser leg of npm-run-quality and local Playwright runs,
not Node unit concurrency. It reduces contention,not a guaranteed RAM reservation;
other apps can still consume RAM. Do not manually override the local gate above
its budget. Runtime may be longer;no per-test timeout/retry or assertion changes.
CI retains its EXACT existing1worker branch and all other config/settings;no
workflow change. Permanent threshold/invalid/cap/CI-branch tests cover the policy.

Step2 focused policy4/4,typecheck and strict affected ESLint PASS. A literal
before/after comparison againstba1d0f0 allows only the added policy import and
local branch substitution;all other Playwright config,CI config and workflows
match exactly. Observed free3.193GiB selects1worker. Frozen detached quality,
Step2 detached quality-memory COMPLETE exit0,07:02:05.062–08:27:44.975UTC
(85m39.913s):Admin916/916,Customer189/189,browser745PASS+59known conditional
skips,retries0;types/lints/builds/isolation PASS. Log explicitly reports804tests
using1worker. Source remained frozen;test ports4173–4176/4197–4198 closed.
Free-memory samples ranged382619648–3723816960bytes (about0.356–3.468GiB);
one worker reduces test contention but cannot reserve RAM against other apps.
This is not a controlled before/after performance or memory-benefit comparison.
Step2 delivered1473410f20bcc9184fbd4f2f95a2ae59999136b7 after stagedGitleaks0;
exact quality38223824050 all21/21 and secrets38223824077 PASS.
Step3 focus and Step4 text remain pending.
