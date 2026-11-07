# Nawasrah ERP

Arabic RTL wholesale ERP: admin back-office, POS, and customer storefront.

## Overview

Nawasrah ERP supports the daily work of a wholesale shop: selling by carton or packet, receiving goods, managing stock and balances, and processing customer orders. It includes an installable admin application and a separate customer storefront.

Operational and maintenance documentation is maintained in Arabic. Start with the [maintainer guide](docs/MAINTAINER_GUIDE_AR.md), [agent contract](AGENTS.md), and [project overview](docs/agent/PROJECT_OVERVIEW.md). The [Arabic entry point](docs/README_AR.md) provides local setup and operational guidance.

## Key features

- **Catalog and storefront:** categories, product families and flavors, offers, configurable cartons, search, and a shopping cart.
- **Guest orders:** a protected checkout gateway, server-side validation, inventory reservations, order tracking, and receipts.
- **POS and shifts:** cash, CliQ, credit, and partial payments; shift opening, cash reconciliation, closing, and receipt printing.
- **Receiving and suppliers:** direct receiving, supplier balances and payments, returns, and weighted average cost (WAC).
- **Inventory:** opening stock, stock counts, warehouse transfers, returns, replacements, and damaged goods.
- **Receivables and payments:** customer and supplier account statements, collections, expenses, and deferred cheques.
- **Reports:** sales, cost of goods sold, profit, expenses, balances, and inventory movements.
- **Notifications and monitoring:** business summaries and alerts, order push notifications, integrity checks, and separate developer error monitoring.

## Architecture

| Layer | Implementation |
| --- | --- |
| Admin and POS | React, Vite, TypeScript, and Zustand in `src/` |
| Customer storefront | A separate React, Vite, and TypeScript application in `customer-web/` |
| Data and business rules | Supabase PostgreSQL, guarded RPCs, row-level security (RLS), Auth, and Storage |
| Server integrations | Supabase Edge Functions, scheduled database jobs, and event outboxes |
| Hosting | Cloudflare Pages for both web applications |
| Error monitoring | Sentry with environment-specific configuration and privacy filtering |
| Recovery | Encrypted backups and strict verification through isolated Docker restores |

```text
Customer storefront -> guest-order Edge Function -> guarded PostgreSQL RPC
                                                     |
                              order + stock reservation + event outbox
                                                     |
                         admin review -> fulfillment -> receipt / notification
```

PostgreSQL owns business state. The interfaces display and submit operations; they do not provide an alternative accounting or inventory engine.

## Core principles

- Inventory, money, returns, and lifecycle changes go through the approved PostgreSQL/RPC contracts.
- Browser code never receives `service_role` credentials or a database password.
- Historical migrations are immutable. New migrations require approval and coordinated updates to the migration ceiling, references, and operational tools.
- Financial operations preserve idempotency, audit evidence, and recovery of pending attempts. An unknown outcome must be reconciled before creating another operation.
- Tests use isolated local databases and controlled browser fixtures. Hosted access, resets, and deployment require explicit owner authorization.
- Secrets stay outside Git and logs. Monitoring separates business notifications from developer diagnostics.

## Local development

Use **Node.js 24**, npm, and the committed lockfiles. Docker is required for database and restore tests; browser tests also require the matching Playwright browsers. Use a dedicated checkout and follow the [maintainer guide](docs/MAINTAINER_GUIDE_AR.md) before configuring an environment. Do not copy another checkout's `.env*.local` files.

```powershell
npm.cmd ci
npm.cmd --prefix customer-web ci
```

With an approved **local-only** backend configuration, start each application in its own terminal:

```powershell
npm.cmd run dev
npm.cmd --prefix customer-web run dev
```

For UI fixtures without a hosted backend, the repository provides loopback-only helpers. Run the stub and each application in separate terminals:

```powershell
node scripts/testing/run-isolated-api-stub.mjs 4176
node scripts/testing/run-isolated-vite.mjs admin 4173
node scripts/testing/run-isolated-vite.mjs customer 4174
```

These fixtures are for development and verification; they do not represent a working shop database. Database scenarios use `scripts/testing/bootstrap-isolated-supabase.mjs` through the documented test runners.

## Quality commands

```powershell
npm.cmd run lint
npm.cmd run lint:eslint:strict
npm.cmd test
npm.cmd --prefix customer-web run lint
npm.cmd --prefix customer-web test
npm.cmd run test:browser:isolation
npm.cmd run test:e2e
```

Builds require an explicit environment. For local build verification, including storefront SEO against synthetic loopback data:

```powershell
node scripts/testing/run-customer-isolated-build.mjs
node scripts/testing/run-environment-builds.mjs
```

The aggregate `npm.cmd run quality` command also runs builds and browser checks; prepare its explicit local isolation context as documented in the [maintainer guide](docs/MAINTAINER_GUIDE_AR.md). A plain storefront build can read the configured catalog to generate SEO pages, so it is not a substitute for the isolated build runner.

CI checks TypeScript, ESLint, unit tests, Chromium/WebKit behavior, accessibility, isolated database contracts, secret scanning, and backup recovery. Full delivery checks must pass on the exact PR head. Deployment artifacts are checked by `scripts/environments/verify-dist.mjs`; locally generated fixture artifacts must not be deployed.

## Repository layout

```text
src/                    Admin screens, POS, state, and service adapters
customer-web/           Customer storefront and SEO build tooling
supabase/migrations/    Immutable database migration history
supabase/functions/     Edge Functions and shared server integration code
scripts/                Build, audit, testing, backup, and operational tools
tests/ and e2e/         Unit, contract, integration, and browser tests
docs/                   Design, maintenance, handover, and operational guides
workers/                Independent integration workers
.github/workflows/      Quality, security, monitoring, and recovery checks
```

## Documentation

- [Arabic entry point](docs/README_AR.md)
- [Maintainer guide](docs/MAINTAINER_GUIDE_AR.md): current screen/service/RPC map and safe change procedures
- [AGENTS.md](AGENTS.md): repository agent contract
- [Project overview](docs/agent/PROJECT_OVERVIEW.md) and [operating rules](docs/agent/OPERATING_RULES.md)
- [Architecture](ARCHITECTURE.md) and [database design](DATABASE_DESIGN.md)
- [Owner handover guide](docs/handover/دليل-صاحب-المحل.md) and [go-live cutover plan](docs/operations/GO_LIVE_CUTOVER_AR.md)
- [Backup and restore](scripts/backup/README.md), [monitoring runbooks](docs/operations/MONITORING_RUNBOOKS.md), and [privacy data map](docs/operations/PRIVACY_DATA_MAP.md)

Operational procedures are in Arabic. Use current code, the approved migration ceiling in `docs/agent/project-state.json`, and current owner decisions when assessing system state. `docs/HANDOFF.md` is historical context, not the current maintenance contract. Documentation and passing CI do not authorize deployment or production access.

## Ownership and license

**Proprietary — all rights reserved.** Public availability of this repository does not grant permission to use, copy, modify, or redistribute the software. No open-source license is granted.
