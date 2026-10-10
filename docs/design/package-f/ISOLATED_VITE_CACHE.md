# Isolated browser Vite caches — 2026-10-10

Owner-approved test infrastructure only. Product configuration, RPCs, migrations,
browser assertions, retries and deadlines remain unchanged.

## Evidence before correction

Earlier POS trace: react.js returned200 then504 within149ms; its old server
stdout was discarded, so that historical response's exact504 subtype is unknown.
Do not claim the trace alone proves an optimizer subtype or a specific writer.

Fresh two-server reproduction using actual Vite6 and one temporary shared cache:

```text
Vite: Forced re-optimization of dependencies
HTTP /@fs/.../deps/react-dom_client.js?v=3e173738
504 Outdated Optimize Dep
```

The second optimizer removed an optimized file still referenced by the first
server's metadata/browser. A separate actual late-import probe logged:

```text
✨ new dependencies optimized: lucide-react
✨ optimized dependencies changed. reloading
```

This proves both real cache replacement and late-discovery mechanisms, not the
identity of the historical losing process. The permanent regression reproduces
the shared-cache504, then verifies isolated live servers cannot replace each
other's dependency files.

## Correction

Every test dev server uses `startIsolatedVite`: its own mkdtemp cache under the OS
temporary directory, removed after awaited Vite shutdown. No gitignore change:
the cache is outside the checkout. Existing imperative harness dependency URLs
are mapped to that server's cache; no browser assertion/import is changed.
Explicit initial dependencies are React/client/JSX and lucide-react, imported by
the existing imperative harness/POS/aftercare paths. Production Vite config stays
unchanged. Test-server environments are captured independently and restored.

Applied to run-isolated-vite, phase44-admin-recovery-fullstack,
admin-session-browser-e2e, admin-large-catalog-browser and
customer-checkout-browser-e2e. PWA runner builds static releases, not dev servers,
so it needs no dev-cache correction.

Focused units:3/3 PASS, actual HTTP504 reproduced before correction;20 concurrent
dependency requests return200 after correction; caches absent after awaited stop.
The QA-only loopback shutdown endpoint lets global teardown verify deletion
before Windows taskkill, which cannot execute async signal cleanup. Runtime
runners await Vite.close directly. Generated bundles retain a node_modules path
under OS temp so React/Babel does not transform optimized bundles again.

Unchanged full POS matrix:8/8 Chromium/WebKit PASS (first run also logged a
tool-source reload while the optional logger typing was corrected; final cache
layout/cleanup verified by the subsequent uninterrupted stress run).
Permanent opt-in `--cache-stress`:actual POS absence/recovery and Home light390,
two Vite origins live concurrently, workers2/repeat-each10/retries0:40/40 PASS,
no504 or late dependency-optimization event. The chosen POS flow is zero-business
write so concurrent repeat fixtures cannot falsify global durable snapshots.
Actual ports25432/25430 available in34/42ms,release wait0. No DB/test server or
temporary cache remains;owner n8n untouched.
Final full quality exit0:445 browser PASS/59 existing conditional skips/retries0,
typecheck/ESLint/unit/build/SEO/network isolation PASS,Production escaped0.
Gitleaks,independent infrastructure commits/push and exact-SHA CI still pending.
