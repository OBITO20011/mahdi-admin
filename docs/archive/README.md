# Historical design documents

These documents preserve earlier planning and design decisions. They are not the
current operating contract: `ARCHITECTURE.md` and `DATABASE_DESIGN.md` describe
migration ceiling 102, while the repository's approved ceiling is recorded in
[`project-state.json`](../agent/project-state.json).

For current behavior, start with the [Arabic maintainer guide](../MAINTAINER_GUIDE_AR.md),
[agent contract](../../AGENTS.md), and [project overview](../agent/PROJECT_OVERVIEW.md).
The current implementation and immutable migrations remain authoritative.

- [Project plan](PROJECT_PLAN.md)
- [Design system](DESIGN_SYSTEM.md)
- [Architecture through 102](ARCHITECTURE.md)
- [Database design through 102](DATABASE_DESIGN.md)

Archived on 2026-11-09 as a documentation-only root cleanup. Operational runbooks
and scripts retain their existing locations. Local development and CI use npm
with the committed root and `customer-web` `package-lock.json` files; the unused
root Bun lockfile was removed without changing dependencies.
