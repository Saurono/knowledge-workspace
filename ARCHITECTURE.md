# Modular development

New business functionality belongs in a feature module under `src/modules/`.
Use a modular monolith with explicit public contracts, not shared mutable state
or imports of another feature's private implementation.

- `domain/`: pure rules and models, independent of React, Tauri and stores.
- `application/`: use cases and dependency ports.
- `infrastructure/`: concrete platform/storage/transport adapters.
- `ui/`: presentation and local view state.
- `index.ts` and explicitly declared additional entry points: public API.
- `module.json`: allowed entry points and dependencies.

Do not create empty layers merely to satisfy this layout. The application
composition root wires executors, adapters and cross-feature workflows.
Modules own their data and migrations. Local and Web clients reuse business
contracts and select different platform adapters.

Before submitting a change:

```sh
npm run check:modules
npm run audit:modules:check
npm run typecheck
# Run the module tests and any affected integration checks.
```

The boundary checker is part of CI. It rejects private cross-module imports,
undeclared dependencies, UI/platform coupling in domain code, non-literal module
imports and module dependency cycles. It currently governs the new modules tree;
legacy code is being migrated, with explicit compatibility entry points.

Fifteen modules now contain extracted implementation: star-map, memory, domains,
tasks, quality, wiki, ingestion, retrieval, cli, research, projects, documents, agent, obsidian and settings. See the
[migration status](analysis/architecture/migration-progress.md) for the exact scope
and remaining legacy orchestration.
The complete module inventory, dependency rules, storage ownership and migration
sequence are in [the architecture design](analysis/architecture/modular-design-v1.md).

Task completion must update [TASKS](TASKS.md), append implementation and validation
in [WORKLOG](WORKLOG.md), and refresh the next step in [HANDOFF](HANDOFF.md).
Start a new session by reading those files and checking the actual Git state.

B16 audits production callers across the source tree as well as feature manifests.
The reproducible [boundary audit](analysis/architecture/module-boundary-audit.md)
and [JSON inventory](analysis/architecture/module-audit-v1.json) document the exact
scope. After changing source-file inventory, imports or public contracts, regenerate
with `npm run audit:modules` and commit the report; CI checks its consistency.
