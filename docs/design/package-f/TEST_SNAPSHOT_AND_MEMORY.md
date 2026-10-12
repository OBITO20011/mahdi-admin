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

Step2 local-worker policy,Step3 customer focus repair and Step4 phone text remain
pending separate authorized gates/commits;no completed delivery claim yet.
